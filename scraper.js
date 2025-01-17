const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Asynchronously scrapes an Ethereum account state difference page from Etherscan
 * and extracts relevant table data.
 *
 * @async
 * @function
 * @param {string} txHash - The transaction hash for which the account state difference page will be scraped.
 * @returns {Array<string>} - An array of extracted storage slots that underwent changes (possibly empty), or null.
 *
 * @throws Will throw an error if there is an issue fetching or processing the page content.
 */
async function scrapePage(txHash) {
    url = "https://etherscan.io/accountstatediff?a=" + txHash;

    try {
        //Fetch the HTML of the page and load it into cheerio
        const { data: pageHtml } = await axios.get(url);
        const $ = cheerio.load(pageHtml);

        //Locate the table with the specific class and ID
        const table = $('table#tblAccStateDiff');

        if (table.length) {
            const tableData = [];

            //Extract the table headers
            const headers = [];
            table.find('thead th').each((index, element) => {
                headers.push($(element).text().trim());
            });
            tableData.push(headers);

            //Extract the table rows
            table.find('tbody tr').each((index, element) => {
                const row = [];
                $(element).find('td').each((i, el) => {
                    row.push($(el).text().trim());
                });
                tableData.push(row);
            });

            //Parse the table data
            const parsedTableData = parseTableData(tableData);
    
            //console.log('Extracted Table Data:', parsedTableData);
            console.log('- Etherscan accountstatediff successfully extracted');
            return parsedTableData;
        } else {
            console.log('- Etherscan accountstatediff not found');
            return null;
        }

    } catch (error) {
        console.error('Error scraping the table content:', error);
        return null;
    }
}

/**
 * Parses storage changes from a string containing state changes.
 *
 * @function
 * @param {string} stateChanges - A string containing state changes.
 * @returns {Array<string>} - An array of extracted storage slots that underwent changes.
 */
function parseStorageChanges(stateChanges) {
    const storageAddresses = [];
    const regex = /Storage Address:(0x[0-9a-fA-F]{64})/g;
    let match;

    while ((match = regex.exec(stateChanges)) !== null) {
        storageAddresses.push(match[1]);
    }

    return storageAddresses;
}

/**
 * Parses table data into structured account state difference information.
 *
 * @function
 * @param {Array<Array<string>>} tableData - A 2D array where each sub-array represents a row of table data.
 * @returns {Array<Object>} - An array of objects, each representing an account's state difference data.
 */
function parseTableData(tableData) {
    const parsedData = [];
    let currentAddressEntry = null;

    for (let i = 1; i < tableData.length; i++) {
        const row = tableData[i];

        if (row[1].startsWith('0x')) {
            // This row contains address information
            if (currentAddressEntry) {
                parsedData.push(currentAddressEntry);
            }
            currentAddressEntry = {
                Address: row[1],
                Name: row[2] || null,
                //Before: row[3] || null,
                //After: row[4] || null,
                //StateDifference: row[5] || null,
                ChangedSlots: []
            };
        } else if (currentAddressEntry) {
            // This row contains state changes or additional information for the current address
            currentAddressEntry.ChangedSlots.push(...parseStorageChanges(row[1]));
        }
    }

    // Add the last address entry
    if (currentAddressEntry) {
        parsedData.push(currentAddressEntry);
    }

    return parsedData;
}

module.exports = {
    scrapePage: scrapePage
};