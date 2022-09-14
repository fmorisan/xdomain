import { Button, Col, notification, Row } from 'antd'
import { BigNumber, ContractTransaction, ethers, providers } from 'ethers'
import { formatEther, getAddress, hexStripZeros, hexZeroPad, parseEther } from 'ethers/lib/utils'
import { ReactElement, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  approveSrcGateway,
  DEFAULT_RPC_URLS,
  getAmountsForTeleportGUID,
  getAttestations,
  getDefaultDstDomain,
  initRelayedTeleport,
  mintWithOracles,
  requestFaucetDai,
  requestRelay,
  sleep,
  TeleportGUID,
  waitForRelayTask,
} from 'teleport-sdk'

import {
  DomainChainId,
  DomainName,
  getExplorerURL,
  getSdkDomainId,
  SRC_CHAINID_TO_DST_CHAINID,
  SrcDomainChainId,
} from './domains'
import { useAmounts } from './useAmounts'
import { switchChain, truncateAddress } from './utils'

ethers.utils.Logger.setLogLevel(ethers.utils.Logger.levels.ERROR)

export function useTeleportFlow(
  connectWallet: () => Promise<void>,
  srcChainId: DomainChainId,
  dstChainId: DomainChainId,
  account?: string,
  walletChainId?: number,
  provider?: ethers.providers.Provider,
) {
  const [gulpConfirmed, setGulpConfirmed] = useState<boolean>(false)
  const [approveConfirmed, setApproveConfirmed] = useState<boolean>(false)
  const [burnTx, setBurnTx] = useState<ContractTransaction | undefined>()
  const [checkingBurnConfirmed, setCheckingBurnConfirmed] = useState<boolean>(false)
  const [burnConfirmed, setBurnConfirmed] = useState<boolean>(false)
  const [attestationsRequested, setAttestationsRequested] = useState<boolean>(false)
  const [numSigs, setNumSigs] = useState<number | undefined>()
  const [threshold, setThreshold] = useState<number | undefined>()
  const [signatures, setSignatures] = useState<string | undefined>()
  const [guid, setGuid] = useState<TeleportGUID | undefined>()
  const [pendingAmount, setPendingAmount] = useState<string | undefined>()
  const [payloadSigned, setPayloadSigned] = useState<boolean>(false)
  const [relayTxHash, setRelayTxHash] = useState<string | undefined>()
  const [mintConfirmed, setMintConfirmed] = useState<boolean>(false)
  const [mainButton, setMainButton] = useState<{
    label?: ReactElement
    disabled?: boolean
    loading?: boolean
    onClick?: () => Promise<void>
  }>({})

  const [directMintTx, setDirectMintTx] = useState<ContractTransaction | undefined>()
  const [checkingMintConfirmed, setCheckingMintConfirmed] = useState<boolean>(false)
  const [secondaryButton, setSecondaryButton] = useState<{
    label?: ReactElement
    disabled?: boolean
    loading?: boolean
    onClick?: () => Promise<void>
  }>()

  const [searchParams, setSearchParams] = useSearchParams({})
  const burnTxHash = searchParams.get('txHash')
  const mintTxHash = relayTxHash || searchParams.get('directMintTxHash') // could be relayed or direct mint
  const relayTaskId = searchParams.get('taskId')

  const ethersProvider =
    provider && new ethers.providers.Web3Provider(provider as ethers.providers.ExternalProvider, 'any')
  const sender = ethersProvider?.getSigner()
  const srcDomain = getSdkDomainId(srcChainId)

  const relayParams =
    (sender &&
      guid &&
      signatures && {
        receiver: sender,
        teleportGUID: guid,
        signatures,
      }) ||
    undefined

  const {
    amount: amount_,
    maxAmount,
    maxFeePercentage,
    dstBalance,
    bridgeFee,
    relayFee,
    allowance,
    setAmount,
    updateMaxAmount,
    updateDstBalance,
    updateAllowance,
  } = useAmounts(srcChainId, account, relayParams)
  const amount = guid ? formatEther(BigNumber.from(guid.amount)) : amount_ // make sure to always use guid.amount if any

  function resetState() {
    setSearchParams({})
    setGulpConfirmed(false)
    setApproveConfirmed(false)
    setBurnTx(undefined)
    setCheckingBurnConfirmed(false)
    setBurnConfirmed(false)
    setAttestationsRequested(false)
    setNumSigs(undefined)
    setThreshold(undefined)
    setSignatures(undefined)
    setGuid(undefined)
    setPendingAmount(undefined)
    setPayloadSigned(false)
    setRelayTxHash(undefined)
    setMintConfirmed(false)
    setSecondaryButton(undefined)
  }

  function getTxDescription() {
    function getTxHashRow(label: string, chainId: DomainChainId, txHash: string | null) {
      return (
        txHash && (
          <Row>
            <Col>
              <span>
                {label}{' '}
                <Button type="link" target="_blank" href={getExplorerURL(chainId, txHash)} style={{ paddingLeft: 0 }}>
                  {truncateAddress(txHash, 8, 0)}
                </Button>
              </span>
            </Col>
          </Row>
        )
      )
    }
    const dstChainId = SRC_CHAINID_TO_DST_CHAINID[srcChainId as SrcDomainChainId]
    return (
      <>
        {getTxHashRow('L2 DAI Burned:', srcChainId, burnTxHash)}
        {getTxHashRow('L1 DAI Minted:', dstChainId, mintTxHash)}
      </>
    )
  }

  function waitForTx(
    provider: providers.Provider,
    txObject: ContractTransaction | undefined,
    txHash: string,
    checkingTxConfirmed: boolean,
    setCheckingTxConfirmed: (value: React.SetStateAction<boolean>) => void,
    setTxConfirmed: (value: React.SetStateAction<boolean>) => void,
    txDescription?: string,
    successNotificationTitle?: string,
    failureNotificationTitle?: string,
    successNotificationDuration?: number | null,
  ) {
    const handleReceipt = (receipt: ethers.ContractReceipt) => {
      if (receipt.status === 1) {
        console.log(`${txDescription ?? 'tx'} confirmed!`)
        setTxConfirmed(true)
        notification.success({
          message: successNotificationTitle || 'Transaction Confirmed',
          description: getTxDescription(),
          duration: successNotificationDuration,
        })
      } else if (receipt.status === 0) {
        notification.error({
          message: failureNotificationTitle || 'Transaction Failed',
          description: getTxDescription(),
          duration: null,
        })
        throw new Error(`${txDescription ?? 'tx'} failed: receipt=${receipt}`)
      }
    }
    if (!checkingTxConfirmed) {
      setCheckingTxConfirmed(true)
      if (txObject) {
        const waitForTxObject = async () => {
          const receipt = await txObject.wait()
          handleReceipt(receipt)
        }
        waitForTxObject().catch(console.error)
      } else {
        const waitForTxReceipt = async () => {
          let receipt = null
          let attempt = 1
          while (!receipt && attempt <= 10) {
            receipt = await provider.getTransactionReceipt(txHash)
            if (receipt) {
              handleReceipt(receipt)
              return
            } else {
              await sleep(1000 * attempt)
              attempt++
            }
          }
          console.error(`getTransactionReceipt(${txDescription ?? 'tx'} hash=${txHash}): no receipt after 10 attempts.`)
        }
        waitForTxReceipt()
          .catch(console.error)
          .finally(() => setCheckingTxConfirmed(false))
      }
    }
  }

  function doBurn() {
    if (!account || !walletChainId || !provider) {
      setMainButton({
        label: <>Connect Wallet</>,
        onClick: connectWallet,
      })
    } else if (srcChainId !== walletChainId) {
      setMainButton({
        label: (
          <>
            Switch to &nbsp;
            <DomainName chainId={srcChainId} />
          </>
        ),
        onClick: async () => provider && (await switchChain(srcChainId, provider as ethers.providers.ExternalProvider)),
      })
    } else if (
      !burnTxHash &&
      ![10, 42161].includes(srcChainId) &&
      !gulpConfirmed &&
      maxAmount &&
      parseEther(maxAmount).eq(0)
    ) {
      setMainButton({
        label: <>Claim Faucet DAI</>,
        onClick: async () => {
          const tx = await requestFaucetDai({ sender: sender!, srcDomain })
          const receipt = await tx.wait()
          if (receipt.status === 1) {
            setGulpConfirmed(true)
          }
        },
      })
    } else if (!burnTxHash && !approveConfirmed && parseEther(allowance || '0').lt(parseEther(amount || '0'))) {
      setMainButton({
        label: <>Approve DAI</>,
        onClick: async () => {
          const { tx } = await approveSrcGateway({ sender: sender!, srcDomain })
          const receipt = await tx?.wait()
          if (receipt?.status === 1) {
            setApproveConfirmed(true)
          }
        },
      })
    } else if (!burnTxHash) {
      setMainButton({
        label: <>Initiate Teleport</>,
        disabled: parseEther(amount || '0').eq(0),
        onClick: async () => {
          const { tx } = await initRelayedTeleport({
            receiverAddress: account,
            srcDomain,
            amount: parseEther(amount || '0'),
            sender,
          })
          console.log(`DAI burn tx submitted on ${srcDomain}: ${tx!.hash}`)
          setPendingAmount(amount)
          setSearchParams({ txHash: tx!.hash, chainId: srcChainId.toString() })
          setBurnTx(tx)
        },
      })
    } else if (!burnConfirmed) {
      setMainButton({
        label: <>Initiating Teleport...</>,
        loading: true,
      })
      waitForTx(
        ethersProvider!,
        burnTx,
        burnTxHash,
        checkingBurnConfirmed,
        setCheckingBurnConfirmed,
        setBurnConfirmed,
        'DAI burn tx',
        'Teleport Initiated',
        'Teleport Initiation Failed',
      )
    } else if (!guid || !signatures) {
      setMainButton({
        label: (
          <>
            Waiting for attestations
            {numSigs !== undefined && (
              <>
                . Got {numSigs}/{threshold}
              </>
            )}
            ...
          </>
        ),
        loading: true,
      })
      const waitForAttestations = async () => {
        if (attestationsRequested) return
        setAttestationsRequested(true)
        const { signatures, teleportGUID } = await getAttestations({
          srcDomain: getSdkDomainId(srcChainId),
          txHash: burnTxHash,
          onNewSignatureReceived: (numSig, threshold, teleportGuid_) => {
            console.log(`Oracle attestations received: ${numSig}/${threshold}`)
            setNumSigs(numSig)
            setThreshold(threshold)
            if (teleportGuid_) setGuid(teleportGuid_)
          },
        })
        console.log(`TeleportGUID=${JSON.stringify(teleportGUID)} signatures=${signatures}`)
        notification.info({
          message: 'Oracle Attestations Received',
        })
        setSignatures(signatures)
        setAttestationsRequested(false)
      }
      waitForAttestations().catch(console.error)
    } else {
      const updatePendingAmount = async () => {
        const { pending } = await getAmountsForTeleportGUID({
          teleportGUID: guid,
          srcDomain: getSdkDomainId(srcChainId),
        })
        console.log(`${formatEther(pending)} DAI pending to be minted on L1`)
        setPendingAmount(formatEther(pending))
      }
      updatePendingAmount().catch(console.error)
    }
  }

  function doMint() {
    if (!guid || !signatures) return

    const receiverAddress = getAddress(hexZeroPad(hexStripZeros(guid.receiver), 20))

    if (!relayTaskId && !payloadSigned && (!account || getAddress(account) !== receiverAddress)) {
      setMainButton({
        label: <>Please Connect Account {truncateAddress(receiverAddress)}</>,
        loading: false,
        disabled: true,
      })
    } else if (!payloadSigned && !relayTaskId && !mintTxHash) {
      setMainButton({
        label: <>Sign DAI Mint Request</>,
        loading: false,
        onClick: async () => {
          const taskId = await requestRelay({
            srcDomain,
            receiver: sender!,
            teleportGUID: guid,
            signatures,
            maxFeePercentage,
            relayFee: parseEther(relayFee || '0'),
            onPayloadSigned: (payload, r, s, v) => {
              console.log(`Payload ${payload} signed: r=${r} s=${s} v=${v}`)
              setPayloadSigned(true)
            },
          })
          setSearchParams({ txHash: burnTxHash!, chainId: srcChainId.toString(), taskId })
        },
      })
      setSecondaryButton({
        label: (
          <>
            Mint DAI on &nbsp;
            <DomainName chainId={dstChainId} />
          </>
        ),
        onClick: async () => {
          if (!provider) return
          await switchChain(dstChainId, provider as ethers.providers.ExternalProvider)
          const { tx } = await mintWithOracles({
            srcDomain,
            teleportGUID: guid,
            signatures,
            maxFeePercentage,
            sender,
          })
          console.log(`DAI mint tx submitted on ${getDefaultDstDomain(srcDomain)}: ${tx!.hash}`)
          setSearchParams({ txHash: burnTxHash!, chainId: srcChainId.toString(), directMintTxHash: tx!.hash })
          setDirectMintTx(tx)
        },
      })
    } else if (payloadSigned && !relayTaskId) {
      setMainButton({
        label: <>Creating Relay Task...</>,
        loading: true,
      })
      setSecondaryButton(undefined)
    } else if (payloadSigned && relayTaskId && !mintTxHash) {
      console.log(`Waiting for taskId: ${relayTaskId} ...`)
      void waitForRelayTask({ taskId: relayTaskId, srcDomain })
        .then((txHash) => {
          console.log(`Relayed DAI mint tx submitted on L1: ${txHash}`)
          setRelayTxHash(txHash)
        })
        .catch((error) => {
          console.error(error)
          notification.error({
            message: 'Relay failed 😞',
            description: (
              <>
                Gelato Task
                <Button
                  type="link"
                  target="_blank"
                  href={`https://relay.gelato.digital/tasks/GelatoMetaBox/${relayTaskId}`}
                  style={{ paddingLeft: 6, paddingRight: 6 }}
                >
                  {truncateAddress(relayTaskId, 8, 0)}
                </Button>
                Failed
              </>
            ),
            duration: null,
          })
          setSearchParams({ txHash: burnTxHash!, chainId: srcChainId.toString() }) // remove taskId from url
          setPayloadSigned(false)
        })
      setMainButton({
        label: <>Waiting for relayer...</>,
        loading: true,
      })
      setSecondaryButton(undefined)
    } else if (mintTxHash && !mintConfirmed) {
      setMainButton({
        label: <>Finalizing teleport... </>,
        loading: true,
      })

      const dstDomainRpcUrl = DEFAULT_RPC_URLS[getDefaultDstDomain(srcDomain)]
      const dstProvider = new ethers.providers.JsonRpcProvider(dstDomainRpcUrl)
      waitForTx(
        dstProvider,
        directMintTx,
        mintTxHash,
        checkingMintConfirmed,
        setCheckingMintConfirmed,
        setMintConfirmed,
        'DAI mint tx',
        'Teleport Complete!',
        'Teleport Finalization Failed',
        null, //success notification duration: infinite
      )
      setSecondaryButton(undefined)
    } else {
      resetState()
    }
  }

  useEffect(() => {
    updateAllowance().catch(console.error)
  }, [approveConfirmed, burnConfirmed])

  useEffect(() => {
    if (mintConfirmed) {
      setAmount('0')
    } else if (guid) {
      const am = formatEther(BigNumber.from(guid.amount))
      setAmount(am)
    }
  }, [guid, mintConfirmed])

  useEffect(() => {
    updateMaxAmount().catch(console.error)
  }, [gulpConfirmed, burnConfirmed])

  useEffect(() => {
    if (mintConfirmed) setAmount('0')
    updateDstBalance().catch(console.error)
  }, [mintConfirmed])

  useEffect(() => {
    // console.log({
    //   walletChainId,
    //   srcChainId,
    //   maxAmount,
    //   amount,
    //   gulpConfirmed,
    //   allowance,
    //   approveConfirmed,
    //   burnTxHash,
    //   burnTx,
    //   checkingBurnConfirmed,
    //   burnConfirmed,
    //   numSigs,
    //   guid,
    //   pendingAmount,
    //   payloadSigned,
    //   relayTxHash,
    //   mintTxHash,
    //   mintConfirmed,
    // })

    if (!signatures || pendingAmount === undefined) {
      doBurn()
    } else if (parseEther(pendingAmount).gt(0)) {
      doMint()
    } else {
      notification.info({
        message: 'Teleport already completed.',
        duration: 20,
      })
      resetState()
    }
  }, [
    account,
    walletChainId,
    srcChainId,
    dstChainId,
    provider,
    maxAmount,
    amount,
    bridgeFee,
    relayFee,
    gulpConfirmed,
    allowance,
    approveConfirmed,
    burnTxHash,
    burnTx,
    burnConfirmed,
    numSigs,
    signatures,
    guid,
    pendingAmount,
    payloadSigned,
    relayTaskId,
    relayTxHash,
    mintTxHash,
    directMintTx,
    mintConfirmed,
  ])

  return {
    mainButton,
    gulpConfirmed,
    approveConfirmed,
    burnTxHash,
    burnConfirmed,
    guid,
    relayTaskId,
    mintTxHash,
    mintConfirmed,
    secondaryButton,
    dstBalance,
    amount,
    maxAmount,
    setAmount,
    bridgeFee,
    relayFee,
  }
}
