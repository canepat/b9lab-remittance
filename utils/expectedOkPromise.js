module.exports = function expectedOkPromise(action, gasToUse) {
    return new Promise(function (resolve, reject) {
            try {
                resolve(action());
            } catch(e) {
                reject(e);
            }
        })
        .then(function (txObj) {
            return typeof txObj === "string"
                ? web3.eth.getTransactionReceiptMined(txObj) // regular tx hash
                : typeof txObj.receipt !== "undefined"
                    ? txObj.receipt // truffle-contract function call
                    : typeof txObj.transactionHash === "string"
                        ? web3.eth.getTransactionReceiptMined(txObj.transactionHash) // deployment
                        : txObj; // Unknown last case
        })
        .then(
            function (receipt) {
                // We are in Geth and TestRPC
                if (typeof receipt.status !== "undefined") {
                    // Byzantium
                    assert.equal(receipt.status, 1, "should not have reverted");
                } else {
                    // Pre Byzantium
                    assert.isBelow(receipt.gasUsed, gasToUse, "should not have used all the gas");
                }
            }
        );
    };