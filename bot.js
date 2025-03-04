import ethers from 'ethers'
import chalk from 'chalk'
import dotenv from 'dotenv'
import ora from 'ora'

import { readFile } from 'fs/promises'
const PCS_ABI = JSON.parse(await readFile(new URL('./abi/pancakeswap.json', import.meta.url)))

dotenv.config()

const config = {
  bnb: process.env.BNB_CONTRACT,
  toPurchase: process.env.TO_PURCHASE,
  amountOfBnb: process.env.AMOUNT_OF_BNB,
  factory: process.env.FACTORY,
  router: process.env.ROUTER,
  recipient: process.env.YOUR_ADDRESS,
  slippage: process.env.SLIPPAGE,
  gasPrice: ethers.utils.parseUnits(`${process.env.GWEI}`, 'gwei'),
  gasLimit: process.env.GAS_LIMIT,
  minBnbLiq: process.env.MIN_LIQUIDITY_ADDED,
  tradeInterval: process.env.TRADE_INTERVAL,
  walletMinBnb: process.env.WALLET_MIN_BNB
}

const bsc = process.env.BSC_NODE
const mnemonic = process.env.YOUR_MNEMONIC
const tokenIn = config.bnb
const tokenOut = config.toPurchase
const provider = new ethers.providers.JsonRpcProvider(bsc)
const wallet = new ethers.Wallet.fromMnemonic(mnemonic)
const account = wallet.connect(provider)

const factory = new ethers.Contract(
    config.factory,
    [
        'event PairCreated(address indexed token0, address indexed token1, address pair, uint)',
        'function getPair(address tokenA, address tokenB) external view returns (address pair)'
    ],
    account
)

const router = new ethers.Contract( config.router, PCS_ABI, account )

const erc = new ethers.Contract(
    config.bnb,
    [{"constant": true,"inputs": [{"name": "_owner","type": "address"}],"name": "balanceOf","outputs": [{"name": "balance","type": "uint256"}],"payable": false,"type": "function"}],
    account
)

async function checkBalance(account) {
    let balance = await account.getBalance()
    let humanBalance = ethers.utils.formatEther(balance)
    console.log(chalk.magenta(`[INFO] wallet balance: ${humanBalance} BNB`))
    return humanBalance
}

async function buyAction(buyQuantity) {
    console.log(chalk.yellow('[INFO] ready to buy'))
    try {
        let amountOutMin = 0
        let amountIn = ethers.utils.parseEther(buyQuantity)
        if ( parseInt(config.slippage) !== 0 ){
            let amounts = await router.getAmountsOut(amountIn, [tokenIn, tokenOut])
            amountOutMin = amounts[1].sub(amounts[1].div(`${config.slippage}`))
        }

        console.log(chalk.yellow(`
Buying Token using BNB
=================
tokenIn: ${(amountIn * 1e-18).toString()} ${tokenIn} (BNB)
tokenOut: ${(amountOutMin* 1e-18).toString()} ${tokenOut} (SA)
`))

        let tx = await router.swapExactETHForTokens(
            amountOutMin,
            [tokenIn, tokenOut],
            config.recipient,
            Date.now() + 1000 * 60 * 5, //5 minutes
            {
                'gasLimit': config.gasLimit,
                'gasPrice': config.gasPrice,
                'nonce' : null,
                'value' : amountIn
            })
        let receipt = await tx.wait()
        console.log(`Transaction receipt : https://www.bscscan.com/tx/${receipt.transactionHash}`)
        return ethers.utils.formatEther(amountOutMin)
    } catch(err) {
        console.error(err)
    }
}

async function sellAction(sellQuantity) {
    // tokenOut (SA) -> tokenIn (BNB)
    console.log(chalk.cyan('[INFO] ready to sell'))
    try {
        let amountInMin = 0
        let amountOut = ethers.utils.parseEther(sellQuantity)
        if ( parseInt(config.slippage) !== 0 ){
            let amounts = await router.getAmountsIn(amountOut, [tokenIn, tokenOut])
            amountInMin = amounts[0].sub(amounts[0].div(`${config.slippage}`))
        }

        console.log(
            chalk.cyan(`
Selling Token for BNB
=================
tokenOut: ${(amountOut * 1e-18).toString()} ${tokenOut} (SA)
tokenIn: ${(amountInMin * 1e-18).toString()} ${tokenIn} (BNB)
`))

        let tx = await router.swapExactTokensForETH(
            amountOut,
            amountInMin,
            [tokenOut, tokenIn],
            config.recipient,
            Date.now() + 1000 * 60 * 5, //5 minutes
            {
                'gasLimit': config.gasLimit,
                'gasPrice': config.gasPrice
            })

        let receipt = await tx.wait()
        console.log(`Transaction receipt : https://www.bscscan.com/tx/${receipt.transactionHash}`)
        return ethers.utils.formatEther(amountInMin)
    } catch (err) {
        console.error(err)
    }
}

function sleep(ms=1000) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms)
    })
}

async function waitToTrade(seconds) {
    let waitCount = 0
    console.log(chalk.white.inverse(`[INFO] sleeping for ${seconds} seconds...`))
    let spinner = ora('sleeping').start()
    while (waitCount < seconds) {
        await sleep()
        waitCount++
        spinner.text = `sleeping: ${waitCount}`
    }
    spinner.stop()
    return
}

async function makeSwap(balance,toBuyValue,toSellValue) {
    if (balance > config.walletMinBnb) {
        console.log('toBuyValue =', toBuyValue)
        console.log('toSellValue =', toSellValue)
        if (toSellValue > 0) {
            console.log('[INFO] initiating sell...')
            toBuyValue = await sellAction(toSellValue)
            toSellValue = 0
        } else if (toBuyValue > 0) {
            console.log('[INFO] initiating buy...')
            toSellValue = await buyAction(toBuyValue)
            toBuyValue = 0
        } 
        balance = await checkBalance(account)
        await waitToTrade(config.tradeInterval)
        await makeSwap(balance,toBuyValue,toSellValue)
    }
}

console.log('[INFO] RUNNING. Press ctrl+C to exit.')
let toBuyValue = config.amountOfBnb
let toSellValue = 0
let balance = await checkBalance(account)

await makeSwap(balance,toBuyValue,toSellValue)
console.log('[INFO] Done.')
