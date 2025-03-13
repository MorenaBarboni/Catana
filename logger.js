const fs = require('fs');
const catanaConfig = require('./catana-config');
const path = require("path");

const reportPaths = {
  resultsCsv: path.normalize(catanaConfig.catanaDir + "/results.csv"),
  resultsJson: path.normalize(catanaConfig.catanaDir + "/results.json"),
}

/**
* Setup the standard catana reports: resultsCsv and resultsJson
*/
function setupCatanaReports() {

  let headers = ['transaction', 'function', 'input', 'value', 'hasOutcomeChanged', 'outcomeBefore', 'outcomeAfter',
    'hasStorageChanged', 'storageChanges', 'replayOutcome', 'replayResult', 'replayStatusCode', 'duration\n'];

  fs.writeFileSync(reportPaths.resultsCsv, headers.join("$"), function (err) {
    if (err) return console.log(err);
  })
  fs.writeFileSync(reportPaths.resultsJson, "{}", function (err) {
    if (err) return console.log(err);
  });
}

/**
* Appends the replay testing result to the resultsCsv report
* @param {Object} transaction - the replayed transaction data
* @param {Number} statusCode - the replay testing session status code 
* @param {String} time - the replay testing time in mm.ss.ms format 
*/
function logReplayResultToCsv(transaction, txData, outcomeChanges, storageChanges, statusCode, duration) {
  const reportPath = reportPaths.resultsCsv;

  const hasStorageChanged = storageChanges && storageChanges.length > 0;
  const hasOutcomeChanged = outcomeChanges && Object.keys(outcomeChanges).length > 0 && !outcomeChanges.isEqual;
  if (outcomeChanges) {
    if (outcomeChanges.valueBefore = "") outcomeChanges.valueBefore = "\"\""
    if (outcomeChanges.valueAfter = "") outcomeChanges.valueAfter = "\"\""
  }

  const replayStatusCode = parseReplayStatusCode(statusCode);
  const replayOutcome = getChangesDescription(hasOutcomeChanged, hasStorageChanged, replayStatusCode)

  const row = [transaction.hash, txData.functionName, JSON.stringify(txData.input), txData.value,
    hasOutcomeChanged, outcomeChanges ? outcomeChanges.valueBefore : null, outcomeChanges ? outcomeChanges.valueAfter : null,
    hasStorageChanged, JSON.stringify(storageChanges), replayOutcome, replayStatusCode, statusCode, duration + '\n'].join("$");

  appendToFile(reportPath, row);
}

/**
* Appends the test results of the current transaction to the resultsJson.
* @param {Object} transaction - the replayed transaction data
* @param {Object} decodedTransaction - ether's parsed transaction data
* @param {Object} storageChanges - the outcomeChanges
* @param {Object} storageChanges - the storageChanges
* @param {Boolean} result - the replay testing session result    
* @param {Number} statusCode - the replay testing session status code 
* @param {Date} duration - the replay testing session duration 
*/
function logReplayResultToJson(transaction, decodedTransaction, outcomeChanges, storageChanges, result, statusCode, duration) {
  const resultsPath = reportPaths.resultsJson;

  let exisitingResults = {};
  if (fs.existsSync(resultsPath)) {
    exisitingResults = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  }

  let jsonResult = prepareJsonResult(transaction, decodedTransaction, outcomeChanges, storageChanges, result, statusCode, duration);

  exisitingResults[transaction.hash] = jsonResult;

  fs.writeFileSync(resultsPath, JSON.stringify(exisitingResults, null, 2), 'utf8', (err) => {
    if (err) console.log(err);
  });

  //console.log(`> Result logged for transaction ${transaction.hash}`);
}

/**
* Appends a  row to a txt or csv file
* @param {String} path - the csv file path
* @param {String} row - the row to append
*/
function appendToFile(filePath, row) {

  if (fs.existsSync(filePath)) {
    fs.appendFileSync(filePath, row, function (err) {
      if (err) return console.log(err);
    })
  } else {
    throw new Error('Could not access ' + filePath)
  }
}


/**
* Prepares the test results to be logged for a given transaction
* @param {Object} transaction - the replayed transaction data
* @param {Object} decodedTransaction - ether's parsed transaction data
* @param {Object} storageChanges - the outcomeChanges
* @param {Object} storageChanges - the storageChanges
* @param {Boolean} result - the replay testing session result    
* @param {Number} statusCode - the replay testing session status code
* @param {Date} duration - the replay testing session duration 
* @returns an object representing the replay testing result
*/
function prepareJsonResult(transaction, decodedTransaction, outcomeChanges, storageChanges, result, statusCode, duration) {
  //Transaction data 
  let txData = {
    "hash": transaction.hash,
    "functionName": transaction.functionName,
    "input": [],
    "value": transaction.value
  }
  //Transaction arguments
  for (let i = 0; i < decodedTransaction.fragment.inputs.length; i++) {
    let paramData = {}
    const paramName = decodedTransaction.fragment.inputs[i].name;
    const paramDecodedValue = decodedTransaction.args[i];
    paramData[paramName] = String(paramDecodedValue);
    txData.input.push(paramData);
  }

  let jsonResult = {
    "replayOutcome": result,
    "statusCode": statusCode,
    "tx": txData,
    "outcomeChanges": outcomeChanges,
    "storageChanges": storageChanges,
    "testDuration": getTimestamp(duration)
  }

  return jsonResult
}

/**
 * Searches the "resultsJson" file for a transaction execution and extracts its data
 * @param {String} txHash -  the transaction hash
 * @param {String} field -  the name of the field to be read 
 * @returns the transaction data
 */
function readDataFromJson(txHash, field) {
  const jsonData = JSON.parse(fs.readFileSync(reportPaths.resultsJson, 'utf8'));
  const txData = jsonData[txHash];

  if (txData && txData !== undefined) {
    return txData[field];
  }

  return null;
}

/**
* Creates a timestamp in "hh.mm.ss" format 
* @param {Date} duration - the duration to be convered
* @returns a timestamp in "hh.mm.ss" format 
*/
function getTimestamp(duration) {
  hours = Math.floor(duration / (1000 * 60 * 60));
  minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
  seconds = Math.floor((duration % (1000 * 60)) / 1000);

  return hours + "." + minutes + "." + seconds;
}

/**
* Parse the status code of a replay testing session
* @param {Number} statusCode - the status code of a replay testing session
* @returns {String} a string describing the meaning of the status code
*/
function parseReplayStatusCode(statusCode) {
  switch (statusCode) {
    case 0: return "success-passed"; //succesfful replay session without changes
    case 1: return "success-failed"; //succesfful replay session with changes
    case 2: return "error-timeout-on-deployed"; //timeout on original contract
    case 3: return "error-timeout-on-upgraded"; //timeout on upgraded contract
    case 4: return "error-missing-outcome"; //error in the transaction outcome
    case 10: return "not-executed"; //uncompilable contract
    case null: return "not-executed"; // replay session not executed
    default: return "error-unknown";  // unknown error
  }
}

/**
* Parse the outcome of the replay session for a given transaction
* @param {boolean} hasOutcomeChanged - whether the outcome of the transaction changed
* @param {boolean} hasStorageChanged -  whether the storage changed
* @param {number} replayStatusCode -  the replay status code


* @returns {String} a string describing the outcome of the replay session
*/
function getChangesDescription(hasOutcomeChanged, hasStorageChanged, replayStatusCode) {
  let replayOutcome;

  if (replayStatusCode !== 0 && replayStatusCode !== 1) {
    replayOutcome = "unknown";
  } else if (hasOutcomeChanged && hasStorageChanged) {
    replayOutcome = "outcome-storage-changed";
  } else if (hasOutcomeChanged) {
    replayOutcome = "outcome-changed";
  } else if (hasStorageChanged) {
    replayOutcome = "storage-changed";
  } else {
    replayOutcome = "none-changed";
  }
  return replayOutcome;
}

module.exports = {
  getTimestamp: getTimestamp,
  logReplayResultToCsv: logReplayResultToCsv,
  logResultToJson: logResultToJson,
  reportPaths: reportPaths,
  readDataFromJson: readDataFromJson,
  setupCatanaReports: setupCatanaReports
};