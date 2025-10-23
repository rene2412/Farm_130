document.getElementById('roi-form').addEventListener('submit', function(e) {
    e.preventDefault();
    const acreage = parseFloat(document.getElementById('acreage').value);
    const initialCost = parseFloat(document.getElementById('initial-cost').value);
    const annualMaintenance = parseFloat(document.getElementById('annual-maintenance').value);
    const expectedYield = parseFloat(document.getElementById('expected-yield').value);
    const marketPrice = parseFloat(document.getElementById('market-price').value);

    const totalRevenue = acreage * expectedYield * marketPrice;
    const totalCosts = initialCost + annualMaintenance;
    const netProfit = totalRevenue - totalCosts;
    const roiPercentage = ((netProfit / initialCost) * 100).toFixed(2);

    document.getElementById('total-revenue').textContent = '$' + totalRevenue.toFixed(2);
    document.getElementById('total-costs').textContent = '$' + totalCosts.toFixed(2);
    document.getElementById('net-profit').textContent = '$' + netProfit.toFixed(2);
    document.getElementById('roi-percentage').textContent = roiPercentage + '%';

    document.getElementById('results-display').classList.add('show');

    document.getElementById('results').scrollIntoView({ behavior: 'smooth' });
});