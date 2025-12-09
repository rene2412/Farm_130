const API_URL = 'http://localhost:5000';

let map;
let drawnPolygon = null;
let coordinates = [];
let tempMarkers = [];

document.addEventListener('DOMContentLoaded', function() {
    initializeMap();
    setupEventListeners();
    addResetButton();
});

function initializeMap() {
    map = L.map('map').setView([36.7783, -119.4179], 10);
    
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
    }).addTo(map);

    map.on('click', handleMapClick);
}

function handleMapClick(e) {
    const latlng = e.latlng;
    const marker = L.circleMarker(latlng, {
        radius: 5,
        color: '#4a7c59',
        fillColor: '#6aa84f',
        fillOpacity: 0.8
    }).addTo(map);
    tempMarkers.push(marker);
    
    coordinates.push([latlng.lng, latlng.lat]);
    
    if (coordinates.length >= 3) {
        updatePolygon();
        enableCalculateButton();
        updateCoordinatesDisplay();
    }
}

function updatePolygon() {
    if (drawnPolygon) {
        map.removeLayer(drawnPolygon);
    }
    
    const polygonCoords = coordinates.map(c => [c[1], c[0]]);
    
    drawnPolygon = L.polygon(polygonCoords, {
        color: '#4a7c59',
        fillColor: '#6aa84f',
        fillOpacity: 0.3
    }).addTo(map);
}

function enableCalculateButton() {
    const calcBtn = document.getElementById('calc-btn');
    calcBtn.disabled = false;
    calcBtn.textContent = 'Calculate Recharge Basin ROI';
}

function updateCoordinatesDisplay() {
    const acres = calculateAcres(coordinates);
    const display = document.getElementById('coordinates-display');
    display.textContent = `Area selected: ${acres.toFixed(2)} acres (${coordinates.length} points)`;
}

function calculateAcres(coords) {
    if (coords.length < 3) return 0;
    
    let area = 0;
    for (let i = 0; i < coords.length; i++) {
        const j = (i + 1) % coords.length;
        area += coords[i][0] * coords[j][1];
        area -= coords[j][0] * coords[i][1];
    }
    area = Math.abs(area / 2);
    const sqMiles = area * 69 * 69;
    return sqMiles * 640;
}

function resetDrawing() {
    coordinates = [];
    if (drawnPolygon) {
        map.removeLayer(drawnPolygon);
        drawnPolygon = null;
    }
    
    tempMarkers.forEach(m => map.removeLayer(m));
    tempMarkers = [];
    
    document.getElementById('coordinates-display').textContent = '';
    
    const calcBtn = document.getElementById('calc-btn');
    calcBtn.disabled = true;
    calcBtn.textContent = 'Draw area on map to enable calculation';
}

function addResetButton() {
    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset Map';
    resetBtn.className = 'calculate-btn reset-btn';
    resetBtn.onclick = function(e) {
        e.preventDefault();
        resetDrawing();
    };
    
    const coordDisplay = document.getElementById('coordinates-display');
    coordDisplay.parentElement.appendChild(resetBtn);
}

function setupEventListeners() {
    document.getElementById('calculator-form').addEventListener('submit', handleFormSubmit);
}

async function handleFormSubmit(e) {
    e.preventDefault();
    
    if (coordinates.length < 3) {
        alert('Please draw an area on the map first');
        return;
    }
    showLoading();
    hideError();
    hideResults();

    try {
        const soilData = await fetchSoilData();
        const params = buildCalculationParams(soilData.primarySoil.symbol);
        const results = await calculateResults(params);
        displayResults(soilData, results);
        document.getElementById('results').scrollIntoView({ behavior: 'smooth' });

    } catch (error) {
        showError(error.message);
        console.error('Calculation error:', error);
    } finally {
        hideLoading();
    }
}

async function fetchSoilData() {
    const response = await fetch(`${API_URL}/api/soil`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coordinates })
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch soil data');
    }

    return await response.json();
}

function buildCalculationParams(soilType) {
    return {
        acres: calculateAcres(coordinates),
        soilType: soilType,
        pipelineLength: parseFloat(document.getElementById('pipeline-length').value),
        landCostPerAcre: parseFloat(document.getElementById('land-cost').value),
        waterCost: parseFloat(document.getElementById('water-cost').value),
        waterValue: parseFloat(document.getElementById('water-value').value),
        discountRate: parseFloat(document.getElementById('discount-rate').value) / 100,
        loanYears: parseInt(document.getElementById('loan-years').value),
        wetYearFrequency: parseFloat(document.getElementById('wet-frequency').value),
        wetYearDuration: parseInt(document.getElementById('wet-duration').value)
    };
}

async function calculateResults(params) {
    const response = await fetch(`${API_URL}/api/calculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
    });

    if (!response.ok) {
        throw new Error('Calculation failed');
    }

    const data = await response.json();
    return data.results;
}

function displayResults(soilData, results) {
    document.getElementById('soil-type').textContent = 
        `${soilData.primarySoil.symbol} - ${soilData.primarySoil.desc}`;
    document.getElementById('infiltration-rate').textContent = 
        `${results.infiltrationRate} ft/day`;
    document.getElementById('basin-area').textContent = 
        `${results.acres.toFixed(2)} acres`;
    
    document.getElementById('net-recharge').textContent = 
        `${results.recharge.netRecharge} ac-ft/yr`;
    document.getElementById('operating-days').textContent = 
        `${results.recharge.daysPerYear} days`;
    document.getElementById('wetted-area').textContent = 
        `${results.dimensions.wettedArea} acres`;
    
    document.getElementById('total-cost').textContent = 
        `$${Number(results.costs.totalCost).toLocaleString('en-US', {maximumFractionDigits: 0})}`;
    document.getElementById('annual-payment').textContent = 
        `$${Number(results.costs.annualCapitalPayment).toLocaleString('en-US', {maximumFractionDigits: 0})}`;
    document.getElementById('net-benefit').textContent = 
        `$${Number(results.economics.netBenefit).toLocaleString('en-US', {maximumFractionDigits: 0})}`;
    
    document.getElementById('npv').textContent = 
        `$${Number(results.economics.npv).toLocaleString('en-US', {maximumFractionDigits: 0})}`;
    document.getElementById('bc-ratio').textContent = results.economics.bcRatio;
    document.getElementById('roi').textContent = `${results.economics.roi}%`;

    showResults();
}

function showLoading() {
    document.getElementById('loading').style.display = 'block';
}

function hideLoading() {
    document.getElementById('loading').style.display = 'none';
}

function showError(message) {
    const errorEl = document.getElementById('error-message');
    errorEl.textContent = `Error: ${message}. Please try again or contact support.`;
    errorEl.style.display = 'block';
}

function hideError() {
    document.getElementById('error-message').style.display = 'none';
}

function showResults() {
    document.getElementById('results-display').classList.add('show');
}

function hideResults() {
    document.getElementById('results-display').classList.remove('show');
}