// @ts-check
/* DRS Econ Arcade — the CED's vocabulary, one line each, as the exam uses the terms. This file is
   data: `GLOSSARY` is the list every 📖 in the arcade opens (Arcade.mountGlossary draws it), grouped
   by unit, alphabetical inside a unit is the reader's job. A definition is one sentence a grader would
   accept, with the formula or the graph convention where there is one. Edit freely.
   `Glossary` below is the pure helper the tests and the sheet use. */

const GLOSSARY = [
  // ---- Unit 1: Basic Economic Concepts ----
  { term: 'Scarcity', unit: 1, def: 'Unlimited wants meet limited resources, so every choice has a cost.' },
  { term: 'Opportunity cost', unit: 1, def: 'The value of the next-best alternative given up when a choice is made.' },
  { term: 'Production possibilities curve (PPC)', unit: 1, def: 'The maximum combinations of two goods an economy can produce with its resources and technology; points inside are inefficient, points outside unattainable, and growth shifts it out.' },
  { term: 'Comparative advantage', unit: 1, def: 'The ability to produce a good at a lower opportunity cost than another producer — the basis for specialization and trade.' },
  { term: 'Market equilibrium', unit: 1, def: 'The price at which quantity demanded equals quantity supplied; a shift of demand or supply moves it, a change in price alone moves along the curves.' },
  // ---- Unit 2: Economic Indicators and the Business Cycle ----
  { term: 'Gross domestic product (GDP)', unit: 2, def: 'The market value of all final goods and services newly produced within a country in a period: GDP = C + I + G + (X − M).' },
  { term: 'Real GDP vs nominal GDP', unit: 2, def: 'Nominal GDP is measured at current prices; real GDP is measured at constant base-year prices, so it changes only when output changes. Real GDP = nominal GDP ÷ (price index ÷ 100).' },
  { term: 'GDP deflator', unit: 2, def: 'A price index for everything in GDP: nominal GDP ÷ real GDP × 100.' },
  { term: 'Consumer price index (CPI)', unit: 2, def: 'The cost of a fixed market basket of consumer goods relative to its cost in a base year, times 100.' },
  { term: 'Inflation rate', unit: 2, def: 'The percentage change in a price index from one period to the next: (new − old) ÷ old × 100.' },
  { term: 'Unemployment rate', unit: 2, def: 'Unemployed ÷ labor force × 100, where the labor force is everyone employed plus everyone actively looking for work.' },
  { term: 'Labor force participation rate', unit: 2, def: 'Labor force ÷ working-age population × 100.' },
  { term: 'Natural rate of unemployment', unit: 2, def: 'The unemployment rate at full employment: frictional plus structural unemployment, with no cyclical unemployment.' },
  { term: 'Types of unemployment', unit: 2, def: 'Frictional (between jobs), structural (skills or location do not match the jobs available), cyclical (from a downturn in the business cycle).' },
  { term: 'Business cycle', unit: 2, def: 'The pattern of expansion, peak, contraction and trough in real GDP around its long-run trend.' },
  { term: 'Costs of inflation', unit: 2, def: 'Unexpected inflation redistributes purchasing power from lenders and savers to borrowers and from those on fixed incomes; inflation also adds menu costs, shoe-leather costs and uncertainty.' },
  // ---- Unit 3: National Income and Price Determination ----
  { term: 'Aggregate demand (AD)', unit: 3, def: 'Total planned spending on final goods and services at each price level, C + I + G + Xn; it slopes downward because of the wealth, interest-rate and exchange-rate effects, and it shifts when a component changes for any reason other than the price level.' },
  { term: 'Short-run aggregate supply (SRAS)', unit: 3, def: 'The total output firms produce at each price level while input prices are sticky; it slopes upward and shifts with input prices, productivity, expected inflation and government actions such as business taxes.' },
  { term: 'Long-run aggregate supply (LRAS)', unit: 3, def: 'Vertical at full-employment output: in the long run output depends on resources and technology, not the price level.' },
  { term: 'Price level', unit: 3, def: 'The average level of prices in the economy, measured by a price index; the vertical axis of the AD–AS graph. A change in the price level moves along AD and SRAS — it never shifts them.' },
  { term: 'Full-employment output (Yf)', unit: 3, def: 'The real GDP produced when unemployment is at its natural rate; also called potential output.' },
  { term: 'Recessionary gap', unit: 3, def: 'Short-run equilibrium real GDP below full-employment output; the unemployment rate is above the natural rate.' },
  { term: 'Inflationary gap', unit: 3, def: 'Short-run equilibrium real GDP above full-employment output; the unemployment rate is below the natural rate.' },
  { term: 'Marginal propensity to consume (MPC) and to save (MPS)', unit: 3, def: 'The fractions of an additional dollar of disposable income that are spent and saved; MPC + MPS = 1.' },
  { term: 'Spending multiplier', unit: 3, def: '1 ÷ (1 − MPC), or 1 ÷ MPS: the maximum change in real GDP per dollar of an initial change in spending.' },
  { term: 'Tax multiplier', unit: 3, def: '−MPC ÷ (1 − MPC): the change in real GDP per dollar of a change in taxes; smaller in size than the spending multiplier because part of the first round is saved.' },
  { term: 'Fiscal policy', unit: 3, def: 'Changes in government spending or taxes to influence aggregate demand: expansionary (G up or T down) for a recessionary gap, contractionary (G down or T up) for an inflationary gap.' },
  { term: 'Automatic stabilizers', unit: 3, def: 'Taxes and transfers that change with the business cycle without new legislation — income taxes, unemployment insurance — and so dampen swings in aggregate demand.' },
  { term: 'Long-run self-adjustment', unit: 3, def: 'In a recessionary gap nominal wages eventually fall and SRAS shifts right; in an inflationary gap they rise and SRAS shifts left; either way output returns to full employment.' },
  { term: 'Stagflation', unit: 3, def: 'A rising price level and falling real output at the same time, the result of a leftward shift of short-run aggregate supply.' },
  // ---- Unit 4: Financial Sector ----
  { term: 'Bonds and interest rates', unit: 4, def: 'A bond is a loan with fixed payments; because the payments are fixed, its price and market interest rates move in opposite directions.' },
  { term: 'Nominal interest rate', unit: 4, def: 'The stated rate on a loan or deposit; it is set in the money market and equals the real interest rate plus expected inflation.' },
  { term: 'Real interest rate', unit: 4, def: 'The nominal interest rate minus expected inflation; it is what borrowers and lenders actually respond to, and the price in the loanable funds market.' },
  { term: 'Expected inflation', unit: 4, def: 'The inflation people anticipate; it is built into nominal interest rates and nominal wage demands, and unexpected inflation transfers purchasing power from lenders to borrowers.' },
  { term: 'Functions of money', unit: 4, def: 'A medium of exchange, a unit of account and a store of value.' },
  { term: 'M1 and M2', unit: 4, def: 'M1 is currency in circulation plus checkable deposits; M2 adds near-money such as savings deposits, small time deposits and retail money market funds.' },
  { term: 'Monetary base', unit: 4, def: 'Currency in circulation plus bank reserves; the base the banking system builds the money supply on.' },
  { term: 'Required and excess reserves', unit: 4, def: 'Banks hold a fraction of deposits as reserves; required reserves are the fraction the rule demands, and excess reserves are the rest, which a bank can lend.' },
  { term: 'Money multiplier', unit: 4, def: '1 ÷ reserve requirement: the maximum change in the money supply per dollar of new excess reserves. Banks holding excess reserves or the public holding currency make the actual expansion smaller.' },
  { term: 'Money market', unit: 4, def: 'Money demand, which slopes down in the nominal interest rate, against a vertical money supply set by the central bank; their intersection sets the nominal interest rate.' },
  { term: 'Monetary policy', unit: 4, def: 'The central bank changing interest rates to move aggregate demand: expansionary lowers the interest rate and shifts AD right; contractionary raises it and shifts AD left.' },
  { term: 'Ample reserves and IORB', unit: 4, def: 'When banks hold far more reserves than required, changes in the money supply do not move the interest rate; the Fed steers the federal funds rate by administering the interest rate it pays on reserve balances (IORB). This is the United States today.' },
  { term: 'Limited reserves and open-market operations', unit: 4, def: 'When reserves are scarce, the central bank buys bonds to add reserves, raise the money supply and lower the nominal interest rate, or sells bonds to do the reverse.' },
  { term: 'Federal funds rate', unit: 4, def: 'The interest rate banks charge one another for overnight loans of reserves; the Federal Reserve’s policy rate.' },
  { term: 'Quantitative easing', unit: 4, def: 'Central-bank purchases of long-term assets to lower long-term interest rates when the policy rate is already at its lower bound.' },
  { term: 'Loanable funds market', unit: 4, def: 'Saving supplies funds, borrowing for investment demands them, and the real interest rate is the price; vertical axis the real interest rate, horizontal axis the quantity of loanable funds.' },
  // ---- Unit 5: Long-Run Consequences of Stabilization Policies ----
  { term: 'Short-run Phillips curve', unit: 5, def: 'The inverse relation between inflation and unemployment: a change in aggregate demand moves the economy along it, while supply shocks and changes in expected inflation shift it.' },
  { term: 'Long-run Phillips curve', unit: 5, def: 'Vertical at the natural rate of unemployment: in the long run there is no trade-off between inflation and unemployment.' },
  { term: 'Quantity theory of money', unit: 5, def: 'MV = PQ: with velocity stable and output at potential, faster money growth means higher inflation in the long run.' },
  { term: 'Budget deficit and national debt', unit: 5, def: 'A deficit is government spending above tax revenue in a year; the national debt is the sum of past deficits less surpluses.' },
  { term: 'Crowding out', unit: 5, def: 'Government borrowing increases the demand for loanable funds and raises the real interest rate, reducing interest-sensitive private investment.' },
  { term: 'Economic growth', unit: 5, def: 'A sustained increase in real GDP per capita, drawn as a rightward shift of LRAS and of the PPC; it comes from more or better resources, human capital and technology.' },
  { term: 'Productivity', unit: 5, def: 'Output per unit of input, usually per worker-hour; its growth is the source of long-run growth.' },
  // ---- Unit 6: Open Economy ----
  { term: 'Balance of payments', unit: 6, def: 'The record of a country’s transactions with the rest of the world; the current account and the financial account sum to zero.' },
  { term: 'Current account', unit: 6, def: 'Trade in goods and services, investment income, and transfers; exports and income received are credits, imports and income paid are debits.' },
  { term: 'Financial account', unit: 6, def: 'Purchases and sales of financial and real assets across borders; a capital inflow (a foreigner buying a domestic asset) is a credit.' },
  { term: 'Exchange rate', unit: 6, def: 'The price of one currency in terms of another.' },
  { term: 'Appreciation and depreciation', unit: 6, def: 'A rise (appreciation) or fall (depreciation) in the value of a currency in terms of another currency.' },
  { term: 'Foreign exchange market', unit: 6, def: 'The supply of and demand for one currency, priced in another; demand comes from foreigners buying the country’s goods and assets, supply from residents buying foreign ones.' },
  { term: 'Exchange rates and net exports', unit: 6, def: 'A depreciation makes exports cheaper and imports dearer, so net exports and aggregate demand rise; an appreciation does the reverse.' },
  { term: 'Real interest rates and capital flows', unit: 6, def: 'A relatively higher real interest rate attracts financial capital from abroad, increasing the demand for the currency (it appreciates) and the supply of loanable funds.' }
];

var Glossary = (function () {
  'use strict';
  /** @returns {any[]} the list, or none where the data did not load */
  function all() { return typeof GLOSSARY !== 'undefined' && Array.isArray(GLOSSARY) ? GLOSSARY : []; }
  /** @param {string} q @returns {any[]} the terms whose name or definition contains q, case-blind */
  function find(q) {
    var s = String(q || '').trim().toLowerCase();
    return all().filter(function (g) { return !s || (g.term + ' ' + g.def).toLowerCase().indexOf(s) >= 0; });
  }
  /** @param {any[]} list @returns {Record<string, any[]>} grouped by unit, in the list's order */
  function byUnit(list) {
    /** @type {Record<string, any[]>} */ var out = {};
    (list || all()).forEach(function (g) { (out[String(g.unit)] = out[String(g.unit)] || []).push(g); });
    return out;
  }
  return { all: all, find: find, byUnit: byUnit };
}());

if (typeof module !== 'undefined') module.exports = Glossary;
