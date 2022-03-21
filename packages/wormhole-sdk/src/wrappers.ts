import { Provider } from '@ethersproject/abstract-provider'
import { BigNumberish, Overrides, Signer } from 'ethers'

import { DomainDescription, DomainId, getLikelyDomainId, WormholeBridge, WormholeGUID } from '.'

export interface DomainContext {
  srcDomain: DomainDescription
  destDomain?: DomainId
  srcDomainProvider?: Provider
  destDomainProvider?: Provider
}

export function getWormholeBridge(opts: DomainContext): WormholeBridge {
  return new WormholeBridge({ ...opts, srcDomain: getLikelyDomainId(opts.srcDomain) })
}

export interface InitWormholeOpts {
  sender: Signer
  receiverAddress: string
  amount: BigNumberish
  operatorAddress?: string
  overrides?: Overrides
}

export function initWormhole(opts: InitWormholeOpts & DomainContext): ReturnType<WormholeBridge['initWormhole']> {
  return getWormholeBridge(opts).initWormhole(
    opts.sender,
    opts.receiverAddress,
    opts.amount,
    opts.operatorAddress,
    opts.overrides,
  )
}

export function getAttestations(
  opts: { txHash: string } & DomainContext,
): ReturnType<WormholeBridge['getAttestations']> {
  return getWormholeBridge(opts).getAttestations(opts.txHash)
}

export function getAmountMintable(
  opts: { wormholeGUID: WormholeGUID } & DomainContext,
): ReturnType<WormholeBridge['getAmountMintable']> {
  return getWormholeBridge(opts).getAmountMintable(opts.wormholeGUID)
}

export interface MintWithOracleOpts {
  sender: Signer
  wormholeGUID: WormholeGUID
  signatures: string
  maxFeePercentage?: BigNumberish
  operatorFee?: BigNumberish
  overrides?: Overrides
}

export function mintWithOracles(
  opts: MintWithOracleOpts & DomainContext,
): ReturnType<WormholeBridge['mintWithOracles']> {
  return getWormholeBridge(opts).mintWithOracles(
    opts.sender,
    opts.wormholeGUID,
    opts.signatures,
    opts.maxFeePercentage,
    opts.operatorFee,
    opts.overrides,
  )
}

export interface MintWithoutOracleOpts {
  sender: Signer
  txHash: string
  overrides?: Overrides
}

export function mintWithoutOracles(
  opts: MintWithoutOracleOpts & DomainContext,
): ReturnType<WormholeBridge['mintWithOracles']> {
  return getWormholeBridge(opts).mintWithoutOracles(opts.sender, opts.txHash, opts.overrides)
}
