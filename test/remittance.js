"use strict";

// Import the third-party libraries
const Promise = require("bluebird");

// Import the local libraries and customize the web3 environment
const addEvmFunctions = require("../utils/evmFunctions.js");

addEvmFunctions(web3);

if (typeof web3.eth.getBlockPromise !== "function") {
    Promise.promisifyAll(web3.eth, { suffix: "Promise" });
}
if (typeof web3.evm.increaseTimePromise !== "function") {
    Promise.promisifyAll(web3.evm, { suffix: "Promise" });
}
if (typeof web3.version.getNodePromise !== "function") {
    Promise.promisifyAll(web3.version, { suffix: "Promise" });
}

web3.eth.expectedExceptionPromise = require("../utils/expectedExceptionPromise.js");
web3.eth.expectedOkPromise = require("../utils/expectedOkPromise.js");
web3.eth.getPastBlock = require("../utils/getPastBlock.js");
web3.eth.getTransactionReceiptMined = require("../utils/getTransactionReceiptMined.js");
web3.eth.makeSureHasAtLeast = require("../utils/makeSureHasAtLeast.js");
web3.eth.makeSureAreUnlocked = require("../utils/makeSureAreUnlocked.js");

// Import test sets
const remittanceTestSets = require("./remittanceTestSets.js");

// Import the smart contracts
const Remittance = artifacts.require("./Remittance.sol");

contract('Remittance', function(accounts) {
    const MAX_GAS               = 2000000;
    const TESTRPC_SLOW_DURATION = 10000;
    const GETH_SLOW_DURATION    = 90000;
    const OWNER_COMMISSION      = web3.toBigNumber(web3.toWei(0.15, 'ether')).toNumber();
    const MIN_MONEY             = web3.toBigNumber(web3.toWei(0.15, 'ether')).plus(100).toNumber();
    const MAX_BLOCK_DURATION    = 18;

    const EXCHANGE_HASH    = web3.sha3("exchangeSecret");
    const BENEFICIARY_HASH = web3.sha3("beneficiarySecret");

    let isTestRPC, isGeth, slowDuration;
    before("should identify node", function() {
        return web3.version.getNodePromise()
            .then(function(node) {
                isTestRPC = node.indexOf("EthereumJS TestRPC") >= 0;
                isGeth = node.indexOf("Geth") >= 0;
                slowDuration = isTestRPC ? TESTRPC_SLOW_DURATION : GETH_SLOW_DURATION;
            });
    });

    let coinbase, owner, payer, exchange, beneficiary;
    before("should check accounts", function() {
        assert.isAtLeast(accounts.length, 5, "not enough accounts");

        return web3.eth.getCoinbasePromise()
            .then(function (_coinbase) {
                coinbase = _coinbase;
                // Coinbase gets the rewards, making calculations difficult.
                const coinbaseIndex = accounts.indexOf(coinbase);
                if (coinbaseIndex > -1) {
                    accounts.splice(coinbaseIndex, 1);
                }
                [owner, payer, exchange, beneficiary] = accounts;
                return web3.eth.makeSureAreUnlocked(accounts);
            })
            .then(function() {
                const initial_balance = web3.toWei(3, 'ether');
                return web3.eth.makeSureHasAtLeast(coinbase, [owner, payer, exchange, beneficiary], initial_balance)
                    .then(txObj => web3.eth.getTransactionReceiptMined(txObj));
            });
    });

    let instance;
    beforeEach("should deploy a Remittance instance", function() {
        return Remittance.new(OWNER_COMMISSION, MAX_BLOCK_DURATION, { from: owner, gas: MAX_GAS })
            .then(_instance => {
                instance = _instance;
            });
    });

    describe("#Remittance(ownerCommission, maxBlockDuration)", function() {
        describe("forbidden", function() {
            const invalidCreationTestSet = remittanceTestSets.invalidCreationTestSet;

            invalidCreationTestSet.forEach(invalidCreationTest => {
                const ownerCommission = invalidCreationTest.ownerCommission;
                const maxBlockDuration = invalidCreationTest.maxBlockDuration;

                it(`should forbid (${ownerCommission}, ${maxBlockDuration})`, function() {
                    this.slow(slowDuration);

                    return web3.eth.expectedExceptionPromise(
                        function() {
                            return Remittance.new(ownerCommission, maxBlockDuration, { from: owner, gas: MAX_GAS });
                        },
                        MAX_GAS
                    );
                });
            });
        });

        describe("allowed", function() {
            const validCreationTestSet = remittanceTestSets.validCreationTestSet;

            validCreationTestSet.forEach(validCreationTest => {
                const ownerCommission = validCreationTest.ownerCommission;
                const maxBlockDuration = validCreationTest.maxBlockDuration;

                it(`should allow (${ownerCommission}, ${maxBlockDuration})`, function() {
                    this.slow(slowDuration);

                    let instance;
                    return web3.eth.expectedOkPromise(
                        function() {
                            return Remittance.new(ownerCommission, maxBlockDuration, { from: owner, gas: MAX_GAS })
                                .then(_instance => {
                                    instance = _instance;
                                    return instance;
                                });
                        },
                        MAX_GAS
                    )
                    .then(() => {
                        return web3.eth.getTransactionReceiptMined(instance.transactionHash);
                    })
                    .then(receipt => {
                        assert.strictEqual(receipt.logs.length, 1);
                        return instance.ownerCommission();
                    })
                    .then(_ownerCommission => {
                        assert.strictEqual(_ownerCommission.toNumber(), web3.toBigNumber(ownerCommission).toNumber(),
                            "ownerCommission not assigned in constructor");
                        return instance.maxBlockDuration();
                    })
                    .then(_maxBlockDuration => {
                        assert.equal(_maxBlockDuration.toNumber(), web3.toBigNumber(maxBlockDuration).toNumber(),
                            "maxBlockDuration not assigned in constructor");
                        return instance.raisedFees();
                    })
                    .then(_raisedFees => {
                        assert.strictEqual(_raisedFees.toNumber(), 0,
                            "raisedFees not zero after constructor");
                    });
                });
            });
        });

        it("should have smaller creation cost then provided owner commission", function() {
            this.slow(slowDuration);

            let txObj;
            return web3.eth.getTransactionPromise(instance.transactionHash)
                .then(_txObj => {
                    txObj = _txObj;
                    return web3.eth.getTransactionReceiptMined(instance.transactionHash);
                })
                .then(txReceipt => {
                    const gasCost = txObj.gasPrice * txReceipt.gasUsed;
                    assert.isBelow(OWNER_COMMISSION, gasCost, "owner commission is not below contract creation cost");
                });
        });
        it("should emit LogRemittanceCreation event", function() {
            this.slow(slowDuration);

            return web3.eth.getTransactionReceiptMined(instance.transactionHash)
                .then(receipt => {
                    assert.equal(receipt.logs.length, 1); // just 1 LogRemittanceCreation event

                    const EXPECTED_TOPIC_LENGTH = 4;
                    const receiptRawLogEvent = receipt.logs[0];
                    assert.strictEqual(receiptRawLogEvent.topics[0], web3.sha3("LogRemittanceCreation(address,uint256,uint256)"));
                    assert.strictEqual(receiptRawLogEvent.topics.length, EXPECTED_TOPIC_LENGTH);

                    const receiptLogEvent = instance.LogRemittanceCreation().formatter(receiptRawLogEvent);
                    const eventName = receiptLogEvent.event;
                    const callerArg = receiptLogEvent.args.caller;
                    const ownerCommissionArg = receiptLogEvent.args.ownerCommission;
                    const maxBlockDurationArg = receiptLogEvent.args.maxBlockDuration;
                    assert.strictEqual(eventName, "LogRemittanceCreation", "LogRemittanceCreation name is wrong");
                    assert.strictEqual(callerArg, owner, "LogRemittanceCreation arg caller is wrong");
                    assert.strictEqual(ownerCommissionArg.toNumber(), OWNER_COMMISSION, "LogRemittanceCreation arg ownerCommission is wrong");
                    assert.strictEqual(maxBlockDurationArg.toNumber(), MAX_BLOCK_DURATION, "LogRemittanceCreation arg maxBlockDuration is wrong");
                    assert.equal(Object.keys(receiptLogEvent.args).length + 1, EXPECTED_TOPIC_LENGTH);
                });
        });
    });

    describe("#hash(hash1, hash2, exchange)", function() {
        it("should use the exchange hash to calculate the compound hash", function() {
            this.slow(slowDuration);

            let compoundHash1;
            return instance.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange)
                .then(_compoundHash1 => {
                    compoundHash1 = _compoundHash1;
                    return instance.hash(web3.sha3(""), BENEFICIARY_HASH, exchange);
                })
                .then(_compoundHash2 => {
                    assert.notEqual(compoundHash1, _compoundHash2, "Exchange hash is ignored in hash calculation");
                });
        });
        it("should use the beneficiary hash to calculate the compound hash", function() {
            this.slow(slowDuration);

            let compoundHash1;
            return instance.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange)
                .then(_compoundHash1 => {
                    compoundHash1 = _compoundHash1;
                    return instance.hash(EXCHANGE_HASH, web3.sha3(""), exchange);
                })
                .then(_compoundHash2 => {
                    assert.notEqual(compoundHash1, _compoundHash2, "Beneficiary hash is ignored in hash calculation");
                });
        });
        it("should use the contract instance to calculate the compound hash", function() {
            this.slow(slowDuration);

            let compoundHash1;
            return instance.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange)
                .then(_compoundHash1 => {
                    compoundHash1 = _compoundHash1;
                    return Remittance.new(OWNER_COMMISSION, MAX_BLOCK_DURATION, { from: owner, gas: MAX_GAS });
                })
                .then(_instance2 => {
                    return _instance2.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange)
                })
                .then(_compoundHash2 => {
                    assert.notEqual(compoundHash1, _compoundHash2, "Instance is ignored in hash calculation");
                });
        });
        it("should not use anything else to calculate compound hash", function() {
            this.slow(slowDuration);

            let compoundHash1;
            return instance.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange)
                .then(_compoundHash1 => {
                    compoundHash1 = _compoundHash1;
                    return instance.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange);
                })
                .then(_compoundHash2 => {
                    assert.strictEqual(compoundHash1, _compoundHash2, "Something else is used in hash calculation");
                });
        });
    });

    describe("#setOwnerCommission(newOwnerCommission)", function() {
        it("should fail if called when paused", function() {
            this.slow(slowDuration);

            return instance.pause({ from: owner, gas: MAX_GAS })
                .then(() => instance.ownerCommission())
                .then(_ownerCommission => {
                    const newOwnerCommission = _ownerCommission.plus(1);

                    return web3.eth.expectedExceptionPromise(
                        function() {
                            return instance.setOwnerCommission(newOwnerCommission, { from: owner, gas: MAX_GAS });
                        },
                        MAX_GAS
                    );
                });
        });
        it("should fail if called by non owner", function() {
            this.slow(slowDuration);

            return instance.ownerCommission()
                .then(_ownerCommission => {
                    const newOwnerCommission = _ownerCommission.plus(1);

                    return web3.eth.expectedExceptionPromise(
                        function() {
                            return instance.setOwnerCommission(newOwnerCommission, { from: payer, gas: MAX_GAS });
                        },
                        MAX_GAS
                    );
                });
        });
        it("should forbid new owner commission equal to the old one", function() {
            this.slow(slowDuration);

            return instance.ownerCommission()
                .then(_ownerCommission => {
                    return web3.eth.expectedExceptionPromise(
                        function() {
                            return instance.setOwnerCommission(_ownerCommission, { from: owner, gas: MAX_GAS });
                        },
                        MAX_GAS
                    );
                });
        });
        it("should emit LogOwnerCommissionChanged event", function() {
            this.slow(slowDuration);

            let oldCommission, newCommission;
            return instance.ownerCommission()
                .then(ownerCommission => {
                    oldCommission = ownerCommission;
                    newCommission = ownerCommission.plus(1);
                    return instance.setOwnerCommission(newCommission, { from: owner, gas: MAX_GAS });
                })
                .then(txObj => {
                    assert.isAtMost(txObj.logs.length, txObj.receipt.logs.length);
                    assert.equal(txObj.logs.length, 1); // just 1 LogOwnerCommissionChanged event
                    assert.equal(txObj.receipt.logs.length, 1); // just 1 LogOwnerCommissionChanged event

                    const EXPECTED_ARG_LENGTH = 3;
                    const txLogEvent = txObj.logs[0];
                    const eventName = txLogEvent.event;
                    const callerArg = txLogEvent.args.caller;
                    const oldCommissionArg = txLogEvent.args.oldCommission;
                    const newCommissionArg = txLogEvent.args.newCommission;
                    assert.strictEqual(eventName, "LogOwnerCommissionChanged", "LogOwnerCommissionChanged name is wrong");
                    assert.strictEqual(callerArg, owner, "LogOwnerCommissionChanged arg caller is wrong");
                    assert.strictEqual(oldCommissionArg.toNumber(), oldCommission.toNumber(), "LogOwnerCommissionChanged arg oldCommission is wrong");
                    assert.strictEqual(newCommissionArg.toNumber(), newCommission.toNumber(), "LogOwnerCommissionChanged arg newCommission is wrong");
                    assert.equal(Object.keys(txLogEvent.args).length, EXPECTED_ARG_LENGTH);

                    const EXPECTED_TOPIC_LENGTH = 4;
                    const receiptRawLogEvent = txObj.receipt.logs[0];
                    assert.strictEqual(receiptRawLogEvent.topics[0], web3.sha3("LogOwnerCommissionChanged(address,uint256,uint256)"));
                    assert.strictEqual(receiptRawLogEvent.topics.length, EXPECTED_TOPIC_LENGTH);

                    const receiptLogEvent = instance.LogOwnerCommissionChanged().formatter(receiptRawLogEvent);
                    assert.deepEqual(receiptLogEvent, txLogEvent, "LogOwnerCommissionChanged receipt event is different from tx event");
                });
        });
    });

    describe("#deposit(compoundHash, blockDuration)", function() {
        const blockDuration = 1;

        it("should fail if called when paused", function() {
            this.slow(slowDuration);

            return instance.pause({ from: owner, gas: MAX_GAS })
                .then(() => instance.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange))
                .then(_compoundHash => {
                    return web3.eth.expectedExceptionPromise(
                        function() {
                            return instance.deposit(_compoundHash, blockDuration,
                                { from: payer, gas: MAX_GAS, value: MIN_MONEY });
                        },
                        MAX_GAS
                    );
                });
        });
        it("should fail if compoundHash is zero", function() {
            this.slow(slowDuration);

            return web3.eth.expectedExceptionPromise(
                function() {
                    return instance.deposit(0, blockDuration, { from: payer, gas: MAX_GAS, value: MIN_MONEY });
                },
                MAX_GAS
            );
        });
        it("should fail if blockDuration is greater than maxBlockDuration", function() {
            this.slow(slowDuration);
            
            return instance.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange)
                .then(_compoundHash => {
                    return web3.eth.expectedExceptionPromise(
                        function() {
                            return instance.deposit(_compoundHash, MAX_BLOCK_DURATION + 1,
                                { from: payer, gas: MAX_GAS, value: MIN_MONEY });
                        },
                        MAX_GAS
                    );
                });
        });
        it("should fail if no ether is sent", function() {
            this.slow(slowDuration);

            return instance.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange)
                .then(_compoundHash => {
                    return web3.eth.expectedExceptionPromise(
                        function() {
                            return instance.deposit(_compoundHash, blockDuration,
                                { from: payer, gas: MAX_GAS });
                        },
                        MAX_GAS
                    );
                });
        });
        it("should fail if one payer uses the compound hash used by another one", function() {
            this.slow(slowDuration);

            let compoundHash;
            return instance.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange)
                .then(_compoundHash => {
                    compoundHash = _compoundHash;
                    return instance.deposit(compoundHash, blockDuration,
                        { from: payer, gas: MAX_GAS, value: MIN_MONEY });
                })
                .then(() => {
                    return web3.eth.expectedExceptionPromise(
                        function() {
                            return instance.deposit(compoundHash, blockDuration,
                                { from: owner, gas: MAX_GAS, value: MIN_MONEY });
                        },
                        MAX_GAS
                    );
                }); 
        });
        it("should fail if money sent is not greater than owner commission", function() {
            this.slow(slowDuration);

            return instance.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange)
                .then(_compoundHash => {
                    return web3.eth.expectedExceptionPromise(
                        function() {
                            return instance.deposit(_compoundHash, blockDuration,
                                { from: payer, gas: MAX_GAS, value: OWNER_COMMISSION });
                        },
                        MAX_GAS
                    );
                });
        });
        it("should save payment information", function() {
            this.slow(slowDuration);

            let compoundHash, blockNumber;
            return instance.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange)
                .then(_compoundHash => {
                    compoundHash = _compoundHash;
                    return instance.deposit(compoundHash, blockDuration,
                        { from: payer, gas: MAX_GAS, value: MIN_MONEY });
                })
                .then(txObj => {
                    blockNumber = txObj.receipt.blockNumber;
                    return instance.payments(compoundHash);
                })
                .then(payment => {
                    assert.strictEqual(payment[0], payer, "Payer not saved");
                    assert.strictEqual(payment[1].toNumber(), MIN_MONEY, "Money amount not saved");
                    const blockLimit = blockNumber + blockDuration;
                    assert.strictEqual(payment[2].toNumber(), blockLimit, "Block limit not saved");
                }); 
        });
        it("should emit LogDeposit event", function() {
            this.slow(slowDuration);

            let compoundHash;
            return instance.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange)
                .then(_compoundHash => {
                    compoundHash = _compoundHash;
                    return instance.deposit(compoundHash, blockDuration,
                        { from: payer, gas: MAX_GAS, value: MIN_MONEY });
                })
                .then(txObj => {
                    assert.isAtMost(txObj.logs.length, txObj.receipt.logs.length);
                    assert.equal(txObj.logs.length, 1); // just 1 LogDeposit event
                    assert.equal(txObj.receipt.logs.length, 1); // just 1 LogDeposit event

                    const EXPECTED_ARG_LENGTH = 4;
                    const txLogEvent = txObj.logs[0];
                    const eventName = txLogEvent.event;
                    const callerArg = txLogEvent.args.caller;
                    const compoundHashArg = txLogEvent.args.compoundHash;
                    const blockDurationArg = txLogEvent.args.blockDuration;
                    const amountArg = txLogEvent.args.amount;
                    assert.strictEqual(eventName, "LogDeposit", "LogDeposit name is wrong");
                    assert.strictEqual(callerArg, payer, "LogDeposit arg caller is wrong");
                    assert.strictEqual(compoundHashArg, compoundHash, "LogDeposit arg compoundHash is wrong");
                    assert.strictEqual(blockDurationArg.toNumber(), blockDuration, "LogDeposit arg blockDuration is wrong");
                    assert.strictEqual(amountArg.toNumber(), MIN_MONEY, "LogDeposit arg amount is wrong");
                    assert.equal(Object.keys(txLogEvent.args).length, EXPECTED_ARG_LENGTH);

                    const EXPECTED_TOPIC_LENGTH = 3;
                    const receiptRawLogEvent = txObj.receipt.logs[0];
                    assert.strictEqual(receiptRawLogEvent.topics[0], web3.sha3("LogDeposit(address,bytes32,uint256,uint256)"));
                    assert.strictEqual(receiptRawLogEvent.topics.length, EXPECTED_TOPIC_LENGTH);

                    const receiptLogEvent = instance.LogDeposit().formatter(receiptRawLogEvent);
                    assert.deepEqual(receiptLogEvent, txLogEvent, "LogDeposit receipt event is different from tx event");
                });
        });
    });

    describe("#withdraw(exchangeHash, beneficiaryHash)", function() {
        it("should fail if called when paused", function() {
            this.slow(slowDuration);

            return instance.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange)
                .then(_compoundHash => instance.deposit(_compoundHash, MAX_BLOCK_DURATION,
                    { from: payer, gas: MAX_GAS, value: MIN_MONEY }))
                .then(() => instance.pause({ from: owner, gas: MAX_GAS }))
                .then(() => {
                    return web3.eth.expectedExceptionPromise(
                        function() {
                            return instance.withdraw(EXCHANGE_HASH, BENEFICIARY_HASH,
                                { from: exchange, gas: MAX_GAS });
                        },
                        MAX_GAS
                    );
                });
        });
        it("should fail if exchangeHash is zero", function() {
            this.slow(slowDuration);

            return instance.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange)
                .then(_compoundHash => instance.deposit(_compoundHash, MAX_BLOCK_DURATION,
                    { from: payer, gas: MAX_GAS, value: MIN_MONEY }))
                .then(() => {
                    return web3.eth.expectedExceptionPromise(
                        function() {
                            return instance.withdraw(0, BENEFICIARY_HASH, { from: exchange, gas: MAX_GAS });
                        },
                        MAX_GAS
                    );
                });
        });
        it("should fail if exchangeHash is wrong", function() {
            this.slow(slowDuration);

            return instance.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange)
                .then(_compoundHash => instance.deposit(_compoundHash, MAX_BLOCK_DURATION,
                    { from: payer, gas: MAX_GAS, value: MIN_MONEY }))
                .then(() => {
                    return web3.eth.expectedExceptionPromise(
                        function() {
                            return instance.withdraw("aaa", BENEFICIARY_HASH, { from: exchange, gas: MAX_GAS });
                        },
                        MAX_GAS
                    );
                });
        });
        it("should fail if beneficiaryHash is zero", function() {
            this.slow(slowDuration);

            return instance.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange)
                .then(_compoundHash => instance.deposit(_compoundHash, MAX_BLOCK_DURATION,
                    { from: payer, gas: MAX_GAS, value: MIN_MONEY }))
                .then(() => {
                    return web3.eth.expectedExceptionPromise(
                        function() {
                            return instance.withdraw(EXCHANGE_HASH, 0, { from: exchange, gas: MAX_GAS });
                        },
                        MAX_GAS
                    );
                });
        });
        it("should fail if beneficiaryHash is wrong", function() {
            this.slow(slowDuration);

            return instance.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange)
                .then(_compoundHash => instance.deposit(_compoundHash, MAX_BLOCK_DURATION,
                    { from: payer, gas: MAX_GAS, value: MIN_MONEY }))
                .then(() => {
                    return web3.eth.expectedExceptionPromise(
                        function() {
                            return instance.withdraw(EXCHANGE_HASH, "aaa", { from: exchange, gas: MAX_GAS });
                        },
                        MAX_GAS
                    );
                });
        });
        it("should fail if payment block limit is over", function() {
            this.slow(slowDuration);

            const blockDuration = 2;

            return instance.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange)
                .then(_compoundHash => instance.deposit(_compoundHash, blockDuration,
                    { from: payer, gas: MAX_GAS, value: MIN_MONEY }))
                .then(txObj => web3.eth.getPastBlock(txObj.receipt.blockNumber + blockDuration))
                .then(() => {
                    return web3.eth.expectedExceptionPromise(
                        function() {
                            return instance.withdraw(EXCHANGE_HASH, BENEFICIARY_HASH,
                                { from: exchange, gas: MAX_GAS });
                        },
                        MAX_GAS
                    );
                });
        });
        it("should fail if payment already withdrawn", function() {
            this.slow(slowDuration);

            const beneficiary1Hash = web3.sha3("beneficiary1Secret");
            const beneficiary2Hash = web3.sha3("beneficiary2Secret");

            return instance.hash(EXCHANGE_HASH, beneficiary1Hash, exchange)
                .then(_compoundHash1 => instance.deposit(_compoundHash1, MAX_BLOCK_DURATION,
                    { from: payer, gas: MAX_GAS, value: MIN_MONEY }))
                .then(() => instance.hash(EXCHANGE_HASH, beneficiary2Hash, exchange))
                .then(_compoundHash2 => instance.deposit(_compoundHash2, MAX_BLOCK_DURATION,
                    { from: payer, gas: MAX_GAS, value: MIN_MONEY }))
                .then(() => instance.withdraw(EXCHANGE_HASH, beneficiary1Hash,
                    { from: exchange, gas: MAX_GAS }))
                .then(() => {
                    return web3.eth.expectedExceptionPromise(
                        function() {
                            return instance.withdraw(EXCHANGE_HASH, beneficiary1Hash,
                                { from: exchange, gas: MAX_GAS });
                        },
                        MAX_GAS
                    );
                });
        });
        it("should increase raised fees", function() {
            this.slow(slowDuration);

            return instance.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange)
                .then(_compoundHash => instance.deposit(_compoundHash, MAX_BLOCK_DURATION,
                    { from: payer, gas: MAX_GAS, value: MIN_MONEY }))
                .then(() => instance.withdraw(EXCHANGE_HASH, BENEFICIARY_HASH,
                    { from: exchange, gas: MAX_GAS }))
                .then(() => instance.raisedFees())
                .then(_raisedFees => {
                    assert.strictEqual(_raisedFees.toNumber(), OWNER_COMMISSION,
                        "raisedFees not equal to owner commission");
                });
        });
        it("should transfer net amount to exchange", function() {
            this.slow(slowDuration);

            const money = OWNER_COMMISSION + 10000000;

            let balanceBefore, gasUsed, withdrawTxCost;
            return web3.eth.getBalancePromise(exchange)
                .then(_balanceBefore => {
                    balanceBefore = _balanceBefore;
                    return instance.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange);
                })
                .then(_compoundHash => instance.deposit(_compoundHash, MAX_BLOCK_DURATION,
                    { from: payer, gas: MAX_GAS, value: money }))
                .then(() => instance.withdraw(EXCHANGE_HASH, BENEFICIARY_HASH,
                    { from: exchange, gas: MAX_GAS }))
                .then(txObj => {
                    gasUsed = txObj.receipt.gasUsed;
                    return web3.eth.getTransactionPromise(txObj.tx);
                })
                .then(tx => {
                    withdrawTxCost = tx.gasPrice * gasUsed;
                    return web3.eth.getBalancePromise(exchange);
                })
                .then(_balanceAfter => {
                    const balanceDiff = _balanceAfter.minus(balanceBefore).plus(withdrawTxCost);
                    const netAmount = money - OWNER_COMMISSION;
                    assert.strictEqual(balanceDiff.toNumber(), netAmount,
                        "exchange balance delta not equal to net amount");
                });
        });
        it("should emit LogWithdraw event", function() {
            this.slow(slowDuration);

            const netAmount = 10000000;
            const money = OWNER_COMMISSION + netAmount;

            return instance.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange)
                .then(_compoundHash => instance.deposit(_compoundHash, MAX_BLOCK_DURATION,
                    { from: payer, gas: MAX_GAS, value: money }))
                .then(() => instance.withdraw(EXCHANGE_HASH, BENEFICIARY_HASH,
                    { from: exchange, gas: MAX_GAS }))
                .then(txObj => {
                    assert.isAtMost(txObj.logs.length, txObj.receipt.logs.length);
                    assert.equal(txObj.logs.length, 1); // just 1 LogWithdraw event
                    assert.equal(txObj.receipt.logs.length, 1); // just 1 LogWithdraw event

                    const EXPECTED_ARG_LENGTH = 5;
                    const txLogEvent = txObj.logs[0];
                    const eventName = txLogEvent.event;
                    const callerArg = txLogEvent.args.caller;
                    const exchangeHashArg = txLogEvent.args.exchangeHash;
                    const beneficiaryHashArg = txLogEvent.args.beneficiaryHash;
                    const ownerCommissionArg = txLogEvent.args.ownerCommission;
                    const netAmountArg = txLogEvent.args.netAmount;
                    assert.strictEqual(eventName, "LogWithdraw", "LogWithdraw name is wrong");
                    assert.strictEqual(callerArg, exchange, "LogWithdraw arg caller is wrong");
                    assert.strictEqual(exchangeHashArg, EXCHANGE_HASH, "LogWithdraw arg exchangeHash is wrong");
                    assert.strictEqual(beneficiaryHashArg, BENEFICIARY_HASH, "LogWithdraw arg beneficiaryHash is wrong");
                    assert.strictEqual(ownerCommissionArg.toNumber(), OWNER_COMMISSION, "LogWithdraw arg ownerCommission is wrong");
                    assert.strictEqual(netAmountArg.toNumber(), netAmount, "LogWithdraw arg netAmount is wrong");
                    assert.equal(Object.keys(txLogEvent.args).length, EXPECTED_ARG_LENGTH);

                    const EXPECTED_TOPIC_LENGTH = 4;
                    const receiptRawLogEvent = txObj.receipt.logs[0];
                    assert.strictEqual(receiptRawLogEvent.topics[0], web3.sha3("LogWithdraw(address,bytes32,bytes32,uint256,uint256)"));
                    assert.strictEqual(receiptRawLogEvent.topics.length, EXPECTED_TOPIC_LENGTH);

                    const receiptLogEvent = instance.LogWithdraw().formatter(receiptRawLogEvent);
                    assert.deepEqual(receiptLogEvent, txLogEvent, "LogWithdraw receipt event is different from tx event");
                });
        });
    });

    describe("#withdrawFees()", function() {
        it("should fail if called not by owner", function() {
            this.slow(slowDuration);

            return instance.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange)
                .then(_compoundHash => instance.deposit(_compoundHash, MAX_BLOCK_DURATION,
                    { from: payer, gas: MAX_GAS, value: MIN_MONEY }))
                .then(() => instance.withdraw(EXCHANGE_HASH, BENEFICIARY_HASH,
                    { from: exchange, gas: MAX_GAS }))
                .then(() => {
                    return web3.eth.expectedExceptionPromise(
                        function() {
                            return instance.withdrawFees({ from: beneficiary, gas: MAX_GAS });
                        },
                        MAX_GAS
                    );
                });
        });
        it("should fail if called when paused", function() {
            this.slow(slowDuration);

            return instance.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange)
                .then(_compoundHash => instance.deposit(_compoundHash, MAX_BLOCK_DURATION,
                    { from: payer, gas: MAX_GAS, value: MIN_MONEY }))
                .then(() => instance.withdraw(EXCHANGE_HASH, BENEFICIARY_HASH,
                    { from: exchange, gas: MAX_GAS }))
                .then(() => instance.pause({ from: owner, gas: MAX_GAS }))
                .then(() => {
                    return web3.eth.expectedExceptionPromise(
                        function() {
                            return instance.withdrawFees({ from: owner, gas: MAX_GAS });
                        },
                        MAX_GAS
                    );
                });
        });
        it("should fail if raised fee amount is zero", function() {
            this.slow(slowDuration);

            return instance.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange)
                .then(_compoundHash => instance.deposit(_compoundHash, MAX_BLOCK_DURATION,
                    { from: payer, gas: MAX_GAS, value: MIN_MONEY }))
                .then(() => {
                    return web3.eth.expectedExceptionPromise(
                        function() {
                            return instance.withdrawFees({ from: owner, gas: MAX_GAS });
                        },
                        MAX_GAS
                    );
                });
        });
        it("should transfer fee amount to owner", function() {
            this.slow(slowDuration);

            let balanceBefore, gasUsed, withdrawFeesTxCost;
            return web3.eth.getBalancePromise(owner)
                .then(_balanceBefore => {
                    balanceBefore = _balanceBefore;
                    return instance.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange);
                })
                .then(_compoundHash => instance.deposit(_compoundHash, MAX_BLOCK_DURATION,
                    { from: payer, gas: MAX_GAS, value: MIN_MONEY }))
                .then(() => instance.withdraw(EXCHANGE_HASH, BENEFICIARY_HASH,
                    { from: exchange, gas: MAX_GAS }))
                .then(() => instance.withdrawFees({ from: owner, gas: MAX_GAS }))
                .then(txObj => {
                    gasUsed = txObj.receipt.gasUsed;
                    return web3.eth.getTransactionPromise(txObj.tx);
                })
                .then(tx => {
                    withdrawFeesTxCost = tx.gasPrice * gasUsed;
                    return web3.eth.getBalancePromise(owner);
                })
                .then(_balanceAfter => {
                    const balanceDiff = _balanceAfter.minus(balanceBefore).plus(withdrawFeesTxCost);
                    assert.strictEqual(balanceDiff.toNumber(), OWNER_COMMISSION,
                        "owner balance delta not equal to fee amount");
                });
        });
        it("should emit LogWithdrawFees event", function() {
            this.slow(slowDuration);

            return instance.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange)
                .then(_compoundHash => instance.deposit(_compoundHash, MAX_BLOCK_DURATION,
                    { from: payer, gas: MAX_GAS, value: MIN_MONEY }))
                .then(() => instance.withdraw(EXCHANGE_HASH, BENEFICIARY_HASH,
                    { from: exchange, gas: MAX_GAS }))
                .then(() => instance.withdrawFees({ from: owner, gas: MAX_GAS }))
                .then(txObj => {
                    assert.isAtMost(txObj.logs.length, txObj.receipt.logs.length);
                    assert.equal(txObj.logs.length, 1); // just 1 LogWithdrawFees event
                    assert.equal(txObj.receipt.logs.length, 1); // just 1 LogWithdrawFees event

                    const EXPECTED_ARG_LENGTH = 2;
                    const txLogEvent = txObj.logs[0];
                    const eventName = txLogEvent.event;
                    const callerArg = txLogEvent.args.caller;
                    const feesArg = txLogEvent.args.fees;
                    assert.strictEqual(eventName, "LogWithdrawFees", "LogWithdrawFees name is wrong");
                    assert.strictEqual(callerArg, owner, "LogWithdrawFees arg caller is wrong");
                    assert.strictEqual(feesArg.toNumber(), OWNER_COMMISSION, "LogWithdrawFees arg fees is wrong");
                    assert.equal(Object.keys(txLogEvent.args).length, EXPECTED_ARG_LENGTH);

                    const EXPECTED_TOPIC_LENGTH = 3;
                    const receiptRawLogEvent = txObj.receipt.logs[0];
                    assert.strictEqual(receiptRawLogEvent.topics[0], web3.sha3("LogWithdrawFees(address,uint256)"));
                    assert.strictEqual(receiptRawLogEvent.topics.length, EXPECTED_TOPIC_LENGTH);

                    const receiptLogEvent = instance.LogWithdrawFees().formatter(receiptRawLogEvent);
                    assert.deepEqual(receiptLogEvent, txLogEvent, "LogWithdrawFees receipt event is different from tx event");
                });
        });
    });

    describe("#claim(compoundHash)", function() {
        const blockDuration = 1;

        it("should fail if called when paused", function() {
            this.slow(slowDuration);

            let compoundHash, depositBlockNumber;
            return instance.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange)
                .then(_compoundHash => {
                    compoundHash = _compoundHash;
                    return instance.deposit(compoundHash, blockDuration,
                        { from: payer, gas: MAX_GAS, value: MIN_MONEY });
                })
                .then(txObj => depositBlockNumber = txObj.receipt.blockNumber)
                .then(() => instance.pause({ from: owner, gas: MAX_GAS }))
                .then(() => web3.eth.getPastBlock(depositBlockNumber + blockDuration))
                .then(() => {
                    return web3.eth.expectedExceptionPromise(
                        function() {
                            return instance.claim(compoundHash, { from: payer, gas: MAX_GAS });
                        },
                        MAX_GAS
                    );
                });
        });
        it("should fail if compoundHash is zero", function() {
            this.slow(slowDuration);

            let compoundHash, depositBlockNumber;
            return instance.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange)
                .then(_compoundHash => {
                    compoundHash = _compoundHash;
                    return instance.deposit(compoundHash, blockDuration,
                        { from: payer, gas: MAX_GAS, value: MIN_MONEY });
                })
                .then(txObj => depositBlockNumber = txObj.receipt.blockNumber)
                .then(() => web3.eth.getPastBlock(depositBlockNumber + blockDuration))
                .then(() => {
                    return web3.eth.expectedExceptionPromise(
                        function() {
                            return instance.claim(0, { from: payer, gas: MAX_GAS });
                        },
                        MAX_GAS
                    );
                });
        });
        it("should fail if called not by payer", function() {
            this.slow(slowDuration);

            let compoundHash, depositBlockNumber;
            return instance.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange)
                .then(_compoundHash => {
                    compoundHash = _compoundHash;
                    return instance.deposit(compoundHash, blockDuration,
                        { from: payer, gas: MAX_GAS, value: MIN_MONEY });
                })
                .then(txObj => depositBlockNumber = txObj.receipt.blockNumber)
                .then(() => web3.eth.getPastBlock(depositBlockNumber + blockDuration))
                .then(() => {
                    return web3.eth.expectedExceptionPromise(
                        function() {
                            return instance.claim(compoundHash, { from: beneficiary, gas: MAX_GAS });
                        },
                        MAX_GAS
                    );
                });
        });
        it("should fail if payment block limit is not over", function() {
            this.slow(slowDuration);

            let compoundHash, depositBlockNumber;
            return instance.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange)
                .then(_compoundHash => {
                    compoundHash = _compoundHash;
                    return instance.deposit(compoundHash, MAX_BLOCK_DURATION,
                        { from: payer, gas: MAX_GAS, value: MIN_MONEY });
                })
                .then(() => {
                    return web3.eth.expectedExceptionPromise(
                        function() {
                            return instance.claim(compoundHash, { from: payer, gas: MAX_GAS });
                        },
                        MAX_GAS
                    );
                });
        });
        it("should fail if payment amount has already been claimed", function() {
            this.slow(slowDuration);

            let compoundHash, depositBlockNumber;
            return instance.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange)
                .then(_compoundHash => {
                    compoundHash = _compoundHash;
                    return instance.deposit(compoundHash, blockDuration,
                        { from: payer, gas: MAX_GAS, value: MIN_MONEY });
                })
                .then(txObj => depositBlockNumber = txObj.receipt.blockNumber)
                .then(() => web3.eth.getPastBlock(depositBlockNumber + blockDuration))
                .then(() => instance.claim(compoundHash, { from: payer, gas: MAX_GAS }))
                .then(() => {
                    return web3.eth.expectedExceptionPromise(
                        function() {
                            return instance.claim(compoundHash, { from: payer, gas: MAX_GAS });
                        },
                        MAX_GAS
                    );
                });
        });
        it("should transfer payment amount back to payer", function() {
            this.slow(slowDuration);

            let compoundHash, depositBlockNumber, balanceBefore, gasUsed, claimTxCost;
            return instance.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange)
                .then(_compoundHash => {
                    compoundHash = _compoundHash;
                    return instance.deposit(compoundHash, blockDuration,
                        { from: payer, gas: MAX_GAS, value: MIN_MONEY });
                })
                .then(txObj => depositBlockNumber = txObj.receipt.blockNumber)
                .then(() => web3.eth.getPastBlock(depositBlockNumber + blockDuration))
                .then(() => web3.eth.getBalancePromise(payer))
                .then(_balanceBefore => {
                    balanceBefore = _balanceBefore;
                    return instance.claim(compoundHash, { from: payer, gas: MAX_GAS });
                })
                .then(txObj => {
                    gasUsed = txObj.receipt.gasUsed;
                    return web3.eth.getTransactionPromise(txObj.tx);
                })
                .then(tx => {
                    claimTxCost = tx.gasPrice * gasUsed;
                    return web3.eth.getBalancePromise(payer);
                })
                .then(_balanceAfter => {
                    const balanceDiff = _balanceAfter.minus(balanceBefore).plus(claimTxCost);
                    assert.strictEqual(balanceDiff.toNumber(), MIN_MONEY,
                        "payer balance delta not equal to money");
                });
        });
        it("should emit LogClaim event", function() {
            this.slow(slowDuration);

            let compoundHash;
            return instance.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange)
                .then(_compoundHash => {
                    compoundHash = _compoundHash;
                    return instance.deposit(compoundHash, blockDuration,
                        { from: payer, gas: MAX_GAS, value: MIN_MONEY });
                })
                .then(() => web3.eth.getBlockPromise('latest'))
                .then(latestBlock => web3.eth.getPastBlock(latestBlock.number + blockDuration))
                .then(() => instance.claim(compoundHash, { from: payer, gas: MAX_GAS }))
                .then(txObj => {
                    assert.isAtMost(txObj.logs.length, txObj.receipt.logs.length);
                    assert.equal(txObj.logs.length, 1); // just 1 LogClaim event
                    assert.equal(txObj.receipt.logs.length, 1); // just 1 LogClaim event

                    const EXPECTED_ARG_LENGTH = 3;
                    const txLogEvent = txObj.logs[0];
                    const eventName = txLogEvent.event;
                    const callerArg = txLogEvent.args.caller;
                    const compoundHashArg = txLogEvent.args.compoundHash;
                    const amountArg = txLogEvent.args.amount;
                    assert.strictEqual(eventName, "LogClaim", "LogClaim name is wrong");
                    assert.strictEqual(callerArg, payer, "LogClaim arg caller is wrong");
                    assert.strictEqual(compoundHashArg, compoundHash, "LogClaim arg compoundHash is wrong");
                    assert.strictEqual(amountArg.toNumber(), MIN_MONEY, "LogClaim arg amount is wrong");
                    assert.strictEqual(Object.keys(txLogEvent.args).length, EXPECTED_ARG_LENGTH);

                    const EXPECTED_TOPIC_LENGTH = 4;
                    const receiptRawLogEvent = txObj.receipt.logs[0];
                    assert.strictEqual(receiptRawLogEvent.topics[0], web3.sha3("LogClaim(address,bytes32,uint256)"));
                    assert.strictEqual(receiptRawLogEvent.topics.length, EXPECTED_TOPIC_LENGTH);

                    const receiptLogEvent = instance.LogClaim().formatter(receiptRawLogEvent);
                    assert.deepEqual(receiptLogEvent, txLogEvent, "LogClaim receipt event is different from tx event");
                });
        });
    });

    describe("#()", function() {
        it("should refuse any ether sent directly", function() {
            this.slow(slowDuration);

            return web3.eth.expectedExceptionPromise(
                function() {
                    return instance.sendTransaction({ from: payer, gas: MAX_GAS, value: 1 });
                },
                MAX_GAS
            );
        });
    });
});