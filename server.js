const express = require("express");
const axios = require("axios");
const cors = require("cors");
const xml2js = require("xml2js");
const path = require("path");


const app = express();
app.use(express.json());
app.use(cors());

app.use(express.static(path.join(__dirname)));

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});


function parseAndSortSoils(reportJSON) {
  try {
    const tbody = reportJSON?.section?.table?.[0]?.tbody?.[0];
    if (!tbody?.tr?.length) return null;

    const rows = tbody.tr;
    const soils = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.$?.class === "mapunit") {
        const cell = row.td?.[0];
        const text = cell?.para?.[0]?._ || "";
        const symbol = text.split("--")[0]?.trim();
        const desc = text.split("--")[1]?.trim() || "";
        const acresText = row.td?.[1]?.para?.[0]?._ || "";
        const acres = parseFloat(acresText.replace(/,/g, "")) || 0;
        soils.push({ symbol, desc, acres });
      }
    }

    if (!soils.length) return null;
    soils.sort((a, b) => b.acres - a.acres);
    return soils;
  } catch (err) {
    console.warn("Failed to parse soils:", err.message);
    return null;
  }
}

function getSoilInfiltrationRate(soilSymbol) {
  const soilMap = {
    sand: 1.0,
    sa: 1.0,
    sandy: 0.7,
    sl: 0.7,
    loam: 0.6,
    l: 0.6,
    sil: 0.5,
    sicl: 0.4,
    cl: 0.4,
    si: 0.3,
    clay: 0.05,
    c: 0.05
  };

  const symbol = soilSymbol.toLowerCase();
  for (const [key, rate] of Object.entries(soilMap)) {
    if (symbol.includes(key)) return rate;
  }
  return 0.6; 
}

function calculateRechargeBasin(params) {
  const {
    acres,
    soilType,
    pipelineLength,
    landCostPerAcre = 6000,
    waterCost = 35,
    waterValue = 200,
    discountRate = 0.05,
    loanYears = 10,
    wetYearFrequency = 0.3,
    wetYearDuration = 4, 
    evaporationLoss = 0.3
  } = params;

  const sideLength = Math.sqrt(acres * 43560); 
  const perimeter = 4 * sideLength;

  const topOfLevee = 8; 
  const insideSlope = 4; 
  const outsideSlope = 2; 
  const freeboard = 1; 
  const waterDepth = 1; 

  const centerLeveeVol = (perimeter * topOfLevee * (freeboard + waterDepth)) / 27;
  const insideLeveeVol = (perimeter * insideSlope * Math.pow(freeboard + waterDepth, 2)) / (2 * 27);
  const outsideLeveeVol = (perimeter * outsideSlope * Math.pow(freeboard + waterDepth, 2)) / (2 * 27);
  const totalEarthwork = centerLeveeVol + insideLeveeVol + outsideLeveeVol;


  const landCost = acres * landCostPerAcre;
  const earthworkCost = totalEarthwork * 12; 
  const pipelineCost = pipelineLength * 200; 
  const inletCost = 20000; 
  const subtotal = landCost + earthworkCost + pipelineCost + inletCost;
  const engineeringContingency = subtotal * 0.2;
  const totalCost = subtotal + engineeringContingency;


  const monthlyRate = discountRate / 12;
  const numPayments = loanYears * 12;
  const monthlyPayment = (totalCost * monthlyRate * Math.pow(1 + monthlyRate, numPayments)) / 
                         (Math.pow(1 + monthlyRate, numPayments) - 1);
  const annualCapitalPayment = monthlyPayment * 12;


  const insideLength = sideLength - 2 * (topOfLevee / 2 + insideSlope * (freeboard + waterDepth));
  const wettedArea = Math.pow(insideLength, 2) / 9; 

  const infiltrationRate = getSoilInfiltrationRate(soilType);

  const daysPerYear = wetYearFrequency * (wetYearDuration * 30);
  const grossRecharge = (wettedArea / 4840) * infiltrationRate * daysPerYear; 
  const netRecharge = grossRecharge * (1 - evaporationLoss);

  const annualizedCapitalCost = netRecharge > 0 ? annualCapitalPayment / netRecharge : 0;
  const waterPurchaseCost = waterCost;
  const omCost = 5; 
  const totalAnnualCostPerAcFt = annualizedCapitalCost + waterPurchaseCost + omCost;

  const annualWaterBenefit = netRecharge * waterValue;
  const annualWaterCost = netRecharge * waterCost;
  const annualOMCost = netRecharge * omCost;
  const annualBenefit = annualWaterBenefit - annualWaterCost - annualOMCost;
  const netBenefit = annualBenefit - annualCapitalPayment;

  const pvFactor = (1 - Math.pow(1 + discountRate, -loanYears)) / discountRate;
  const pvBenefits = annualBenefit * pvFactor;
  const npv = pvBenefits - totalCost;
  const bcRatio = pvBenefits / totalCost;
  const roi = (npv / totalCost) * 100;

  return {
    acres,
    soilType,
    infiltrationRate,
    dimensions: {
      sideLength: sideLength.toFixed(0),
      perimeter: perimeter.toFixed(0),
      wettedArea: (wettedArea / 4840).toFixed(2)
    },
    costs: {
      landCost,
      earthworkCost,
      pipelineCost,
      totalCost,
      annualCapitalPayment
    },
    recharge: {
      grossRecharge: grossRecharge.toFixed(2),
      netRecharge: netRecharge.toFixed(2),
      daysPerYear: daysPerYear.toFixed(0)
    },
    economics: {
      annualBenefit: annualBenefit.toFixed(2),
      netBenefit: netBenefit.toFixed(2),
      totalAnnualCostPerAcFt: totalAnnualCostPerAcFt.toFixed(2),
      npv: npv.toFixed(2),
      bcRatio: bcRatio.toFixed(2),
      roi: roi.toFixed(2)
    }
  };
}

app.get("/", (_req, res) => {
  res.json({ status: "Farm Calculator API running" });
});

app.post("/api/soil", async (req, res) => {
  try {
    const { coordinates } = req.body;

    if (!coordinates || !Array.isArray(coordinates) || coordinates.length < 4) {
      return res.status(400).json({ error: "Invalid coordinates. Need at least 4 points." });
    }

    const ring = [...coordinates];
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      ring.push([...first]);
    }

    const geojson = {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: { name: "User Field" },
        geometry: {
          type: "Polygon",
          coordinates: [ring]
        }
      }]
    };

    const url = "https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest";

    const aoiResp = await axios.post(url, {
      SERVICE: "aoi",
      REQUEST: "create",
      AOICOORDS: JSON.stringify(geojson)
    }, { headers: { "Content-Type": "application/json" } });

    const AOIID = aoiResp.data?.id;
    if (!AOIID) {
      return res.status(502).json({ error: "AOI creation failed" });
    }

    const catalogResp = await axios.post(url, {
      SERVICE: "report",
      REQUEST: "getcatalog",
      AOIID
    }, { headers: { "Content-Type": "application/json" } });

    const folders = catalogResp.data?.tables?.[0]?.folders;
    if (!folders) {
      return res.status(502).json({ error: "Invalid catalog format" });
    }

    let selected = null;
    for (const folder of folders) {
      const found = folder.reports.find((r) =>
        r.reportname.toLowerCase().includes("component legend")
      );
      if (found) {
        selected = found;
        break;
      }
    }
    if (!selected) selected = folders[0].reports[0];

    const REPORTID = selected.reportid;

    const reportDataResp = await axios.post(url, {
      SERVICE: "report",
      REQUEST: "getreportdata",
      REPORTID,
      AOIID,
      FORMAT: "short"
    }, { headers: { "Content-Type": "application/json" } });

    const REPORTDATA = reportDataResp.data;
    if (!REPORTDATA) {
      return res.status(502).json({ error: "Failed to fetch report data" });
    }

    const reportResp = await axios.post(url, {
      SERVICE: "report",
      REQUEST: "getreport",
      SHORTFORMDATA: JSON.stringify(REPORTDATA)
    }, { headers: { "Content-Type": "application/json" } });

    const REPORTXML = reportResp.data;
    if (!REPORTXML) {
      return res.status(502).json({ error: "Failed to fetch report" });
    }

    const REPORTJSON = await xml2js.parseStringPromise(REPORTXML);
    if (!REPORTJSON) {
      return res.status(502).json({ error: "Failed to parse report" });
    }

    const soils = parseAndSortSoils(REPORTJSON);
    if (!soils || soils.length === 0) {
      return res.status(404).json({ error: "No soil data found for this area" });
    }

    res.json({
      success: true,
      soils,
      primarySoil: soils[0]
    });
  } catch (err) {
    console.error("Soil API Error:", err.response?.data || err.message);
    res.status(500).json({ 
      error: "Failed to fetch soil data", 
      details: err.response?.data || err.message 
    });
  }
});

app.post("/api/calculate", async (req, res) => {
  try {
    const params = req.body;
    const results = calculateRechargeBasin(params);
    res.json({ success: true, results });
  } catch (err) {
    console.error("Calculate Error:", err.message);
    res.status(500).json({ 
      error: "Calculation failed", 
      details: err.message 
    });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Farm Calculator API running on port ${PORT}`);
});