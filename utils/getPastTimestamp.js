"use strict";

// Import the third-party libraries
let Promise = require("bluebird");
Promise.retry = require("bluebird-retry");

// Import the local libraries and customize the web3 environment
const addEvmFunctions = require("../utils/evmFunctions.js");
const addMinerFunctions = require("../utils/minerFunctions.js");

addEvmFunctions(web3);
addMinerFunctions(web3);

if (typeof web3.eth.getBlockPromise !== "function") {
    Promise.promisifyAll(web3.eth, { suffix: "Promise" });
}
if (typeof web3.evm.increaseTimePromise !== "function") {
    Promise.promisifyAll(web3.evm, { suffix: "Promise" });
}
if (typeof web3.miner.startPromise !== "function") {
    Promise.promisifyAll(web3.miner, { suffix: "Promise" });
}
if (typeof web3.version.getNodePromise !== "function") {
    Promise.promisifyAll(web3.version, { suffix: "Promise" });
}

module.exports = function getPastTimestamp(timestamp) {
    let block;
    return web3.eth.getBlockPromise("latest")
        .then(_block => {
            block = _block;
            return web3.version.getNodePromise()
                .then(node => node.indexOf("EthereumJS TestRPC") >= 0);
        })
        .then(isTestRPC => {
            if (isTestRPC) {
                // TestRPC does support EVM increaseTime+mine JSON-RPC API
                return web3.evm.increaseTimePromise(timestamp - block.timestamp)
                    .then(() => web3.evm.minePromise());
            } else {
                // Wait for Geth to have mined a block after the deadline
                return Promise.delay((timestamp - block.timestamp) * 1000)
                    .then(() => Promise.retry(() => web3.eth.getBlockPromise("latest")
                        .then(block => {
                            if (block.timestamp < timestamp) {
                                return web3.miner.startPromise(1)
                                    .then(() => { throw new Error("Not ready yet"); });
                            }
                        }),
                        { max_tries: 100, interval: 1000, timeout: 100000 }));
            }
        });
}