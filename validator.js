/**
 * VALIDATOR - This module includes the logic for determining outcome and storage changes
 */

//External modules
const chalk = require('chalk');
const crypto = require('crypto');
const path = require('path');
//Catana modules
const catanaConfig = require('./catana-config');

/**
 * Builds an outcome object by comparing txOutcomeOnLogicV1 and txOutcomeOnLogicV2
 * @param {String} txOutcomeOnLogicV1 outcome of the transaction executed on LogicV1
 * @param {String} txOutcomeOnLogicV2 outcome of the transaction executed on LogicV2
 * 
 * @returns outcome - an object representing the result of the replay testing session
 */
function computeOutcome(txOutcomeOnLogicV1, txOutcomeOnLogicV2) {

  let outcome = {}
  //If the outcome is a transaction receipt, the function is not view
  outcome.valueBefore = txOutcomeOnLogicV1.toString();
  outcome.valueAfter = txOutcomeOnLogicV2.toString();
  outcome.isEqual = txOutcomeOnLogicV1.toString() === txOutcomeOnLogicV2.toString() ? true : false;
  return outcome;
}

/**
 * Analyzes the storage layout after the execution of a transaction on LogicV1 and LogiV2. 
 * @param {Object} storageLayoutV1WithValues storage layout after the transaction execution on LogicV1
 * @param {Object} storageLayoutV2WithValues storage layout after the transaction execution on LogicV2
 * 
 * @returns storageDiff - list of variables whose values changed on LogicV2
 */
function computeStorageChanges(storageLayoutV1WithValues, storageLayoutV2WithValues) {

  //Build storageDiff array: list of variables whose values differ when replaying the same tx on LogicV1 and LogicV2
  let storageDiff = [];

  storageLayoutV1WithValues.forEach(sVar1 => {

    //For each sVar1 in storageLayoutV1, find the corresponding sVar2 in storageLayoutV2 
    let sVar2 = findMatchingVariable(sVar1, storageLayoutV2WithValues);
    const valueChanged = !hasSameValue(sVar1, sVar2);
    const slotChanged = !hasSameSlot(sVar1, sVar2);


    //Variable CHANGE - The variable has at least one different element or a different starting slot: add it to storage diff
    if (sVar2 !== undefined && (valueChanged || slotChanged)) {

      let changeDescription = []

      if (slotChanged) { changeDescription.push("slot-changed"); }
      if (valueChanged) {
        changeDescription.push("value-changed");

        //Retrieve only changed mapping elements
        if (sVar1.type === "t_custom_mapping_elements") {
          let updatedMappingVars = getOnlyChangedMappingElements(sVar1, sVar2);
          sVar1 = updatedMappingVars[0];
          sVar2 = updatedMappingVars[1];
        }
      }

      storageDiff = pushVarChangeToStorageDiff(storageDiff, sVar1, sVar2, changeDescription.join(', '));
    }
    //Variable DELETION - The variable was deleted and no longer exists in V2: add it to storage diff
    else if (sVar2 === undefined) {
      storageDiff = pushVarDeletionToStorageDiff(storageDiff, sVar1);
    }
  });

  //Variable ADDITION - The variable is new in V2 - add it to storage diff
  const notInStorageLayoutV1 = (obj2) => !storageLayoutV1WithValues.some(obj1 => obj1.name === obj2.name);
  const varsNotInStorageLayoutV1 = storageLayoutV2WithValues.filter(notInStorageLayoutV1);
  varsNotInStorageLayoutV1.forEach(obj2 => {
    storageDiff = pushVarAdditionToStorageDiff(storageDiff, obj2);
  });

  //Handle scenario where we have multiple vars packed in the same slot
  if (storageDiff.length > 1) {
    storageDiff.forEach(obj => {
      if (!obj.type.startsWith("t_array")) {
        let varsSameSlot = storageDiff.filter(v => parseInt(v.slotAfter) === parseInt(obj.slotAfter));
        if (varsSameSlot.length > 1) {
          let changedVars = getOnlyChangedVarsSameSlot(varsSameSlot, varsSameSlot[0].valueBefore, varsSameSlot[0].valueAfter);
          if (!changedVars.includes(obj)) {
            storageDiff = storageDiff.filter(o => o !== obj);
          }
        }
      }
    });
  }

  return storageDiff;
}

/**
 * Determines if two stateVariables have the same slot
 * @param {Object} sVar1 - the first state variable
 * @param {Object} sVar2 - the second state variable
 * @returns true if the variables have the same slot, false otherwise
 */
function hasSameSlot(sVar1, sVar2) {
  if (sVar1.slot !== sVar2.slot)
    return false;
  return true;
}

/**
 * Determines if two stateVariables have the same value
 * @param {Object} sVar1 - the first state variable
 * @param {Object} sVar2 - the second state variable
 * @returns true if the variables have the same value, false otherwise
 */
function hasSameValue(sVar1, sVar2) {

  if (typeof sVar2.value === "object") {
    const sVar1Slots = Object.keys(sVar1.value);
    const sVar2Slots = Object.keys(sVar2.value);

    // Check if both objects have the same number of keys
    if (sVar1Slots.length !== sVar2Slots.length) {
      //console.log("Different number of keys:", sVar1Slots.length, sVar2Slots.length);
      return false;
    }

    // Check each key in sVar1 if it exists in sVar2 and has the same value
    for (const slot of sVar1Slots) {
      if (sVar2.value[slot].trim() !== sVar1.value[slot].trim()) {
        //console.log(`Mismatch found at key: ${slot}`);
        //console.log(`sVar1 value: ${sVar1.value[slot]}`);
        //console.log(`sVar2 value: ${sVar2.value[slot]}`);
        return false;
      }
    }
  }
  else {
    // If they are not objects, simply compare their values directly
    if (sVar2.value !== sVar1.value) {
      //console.log(`Direct value mismatch: ${sVar1.value} !== ${sVar2.value}`);
      return false;
    }
  }
  return true;
}


/**
 * If two t_custom_mapping_elements variables have different values,
 * only keep those elements that actually changed.
 * @param {Object} sVar1 - the first state variable
 * @param {Object} sVar2 - the second state variable
 * @returns an array [svar1, svar2] with the updated variables containing only the changed mapping elements
 */
function getOnlyChangedMappingElements(sVar1, sVar2) {

  if (sVar1.type === "t_custom_mapping_elements") {
    const sVar1Slots = Object.keys(sVar1.value);

    let changedSvar1Value = {}
    let changedSvar2Value = {}


    // Check each key in sVar1 if it exists in sVar2 and has the same value
    for (const slot of sVar1Slots) {
      if (sVar2.value[slot].trim() !== sVar1.value[slot].trim()) {
        changedSvar1Value[slot] = sVar1.value[slot];
        changedSvar2Value[slot] = sVar2.value[slot];
      }
    }
    sVar1.value = changedSvar1Value;
    sVar2.value = changedSvar2Value;
    sVar1.numberOfElements = Object.keys(sVar1.value).length;
    sVar2.numberOfElements = Object.keys(sVar2.value).length;
    return [sVar1, sVar2];
  }

}


/**
 * Given a variable from storageLayoutV1, it looks for the matching state variable from the storageLayoutV2
 * @param {Object} sVar1 - a state variable from the deployed contract
 * @param {Object} storageLayoutV2WithValues - the storage layout of the upgraded contract
 */
function findMatchingVariable(sVar1, storageLayoutV2WithValues) {
  let sVar2;

  //The variable should have the same name and parent source
  const matchingVarV2 = storageLayoutV2WithValues.filter(v =>
    v.name === sVar1.name &&
    (path.normalize(v.parentSource) === path.normalize(sVar1.parentSource).replace(path.normalize(catanaConfig.DeployedSourcesDir), "contracts")) &&
    v.contract === sVar1.contract
  );
  //Variable was deleted
  if (matchingVarV2.length === 0) {
    sVar2 = undefined;
  }
  //Single matching variable
  else if (matchingVarV2.length === 1) {
    sVar2 = matchingVarV2[0];
  }
  else {
    throw new Error("There should be only one matching state variable.")
  }
  return sVar2;
}

/**
 * Push a diff into the storageDiff array where obj1 was changed after the upgrade
 * @param {Array} storageDiff - the current storageDiff
 * @param {Object} obj1 - the state variable data before the upgrade
 * @param {Object} obj2 - the state variable data after the upgrade
 * @param {String} changeDescription - the change description * 
 * @returns 
 */
function pushVarChangeToStorageDiff(storageDiff, obj1, obj2, changeDescription) {
  const { value, slot, decodedValue, ...obj1WithoutValueAndSlot } = obj1;

  storageDiff.push({
    ...obj1WithoutValueAndSlot,
    change: changeDescription,
    slotBefore: obj1.slot,
    slotAfter: obj2.slot,
    valueBefore: obj1.value,
    valueAfter: obj2.value,
    decodedValueBefore: obj1.decodedValue,
    decodedValueAfter: obj2.decodedValue
  });

  console.log(chalk.red("    Warning: " + changeDescription + " for " + obj1.name + " : @initial_slot: " + obj1.slot));
  return storageDiff;
}

/**
 * Push a diff into the storageDiff array where obj1 was deleted after the upgrade
 * @param {Array} storageDiff - the current storageDiff
 * @param {Object} obj1 - the state variable data before the upgrade
 * @returns the updated storageDiff
 */
function pushVarDeletionToStorageDiff(storageDiff, obj1) {
  const { value, slot, decodedValue, ...obj1WithoutValueAndSlot } = obj1;
  storageDiff.push({
    ...obj1WithoutValueAndSlot,
    change: "variable-deleted",
    slotBefore: obj1.slot,
    slotAfter: "deleted",
    valueBefore: obj1.value,
    valueAfter: "deleted",
    decodedValueBefore: obj1.decodedValue,
    decodedValueAfter: "deleted"
  });
  console.log(chalk.red("    Warning: variable-deleted for " + obj1.name + " : @initial_slot: " + obj1.slot));
  return storageDiff;
}

/**
 * Push a diff into the storageDiff array where obj2 was added after the upgrade
 * @param {Array} storageDiff - the current storageDiff
 * @param {Object} obj2 - the state variable data after the upgrade
 * @returns the updated storageDiff
 */
function pushVarAdditionToStorageDiff(storageDiff, obj2) {
  const { value, slot, decodedValue, ...obj2WithoutValueAndSlot } = obj2;
  storageDiff.push({
    ...obj2WithoutValueAndSlot,
    change: "variable-added",
    slotBefore: "none",
    slotAfter: obj2.slot,
    valueBefore: "none",
    valueAfter: obj2.value,
    decodedValueBefore: "none",
    decodedValueAfter: obj2.decodedValue
  });
  console.log(chalk.red("    Warning: variable-added for " + obj2.name + " : @initial_slot: " + obj2.slot));
  return storageDiff;
}

/**
 * If a storage value changed, but its slot embeds multiple variables, return the impacted one(s)
 * @param {Array} varsSameSlot the list of variables stored in the same slot
 * @param {String} valueBefore the value before the upgrade
 * @param {String} valueAfter the value after the upgrade
 * @returns the list of variables that changed
 */
function getOnlyChangedVarsSameSlot(varsSameSlot, valueBefore, valueAfter) {

  let changedVars = [];

  varsSameSlot.forEach(sVar => {

    const end = valueBefore.length - (sVar.offset * 2);
    const start = end - (sVar.numberOfBytes * 2);
    const sVarValueBefore = valueBefore.slice(start, end);
    const sVarValueAfter = valueAfter.slice(start, end);

    if (sVarValueBefore.toString() !== sVarValueAfter.toString()) {
      changedVars.push(sVar);
    }
  });
  return changedVars;
}

/**
* Determines whether a replay testing run passed or failed based on:
* - output changes
* - storage changes (disabled for now)
* @param {Object} outcome the outcome object obtained after replaying the same tx on LogicV1 and LogicV2
* @param {Object} storageChanges the storage changes that occurred when replaying the same tx on LogicV1 and LogicV2
* @returns true if the replay session passed, false otherwise
*/
function getReplayTestingResult(outcome, storageChanges) {

  if (outcome.isEqual) {
    return true;
  }
  return false;

  /* //Retrieve storage slot where the implementation is saved 
   const proxyImplementationSlot = extractProxyImplementationSlot()
   //const hexImplementatonSlotKey = ethers.hexlify(ethers.zeroPadValue("0x" + proxyImplementationSlot.toString(16), 32));
 
   //There are no changes or only the implementation slot changed
   if (storageChanges.length === 0 || (storageChanges.length === 1 && storageChanges.some(c => parseInt(c.slot) === parseInt(proxyImplementationSlot)))) {
     //console.log(chalk.green("\nDIFF: Only the implementation slot changed"));
     return true;
   } else {
     //console.log(chalk.red("\nDIFF: " + Object.keys(changes).length + " variables changed:"));
     return false;
   }*/
}

module.exports = {
  computeOutcome: computeOutcome,
  computeStorageChanges: computeStorageChanges,
  getReplayTestingResult: getReplayTestingResult
};