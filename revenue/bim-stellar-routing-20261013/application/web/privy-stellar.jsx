"use client";
import {useEffect,useMemo,useRef} from "react";
import {usePrivy} from "@privy-io/react-auth";
import {useCreateWallet,useSignRawHash} from "@privy-io/react-auth/extended-chains";
import {createPrivyDriver} from "./bim-wallets.mjs";
/**
 * Mount inside the application's configured PrivyProvider.
 * This component performs no login, wallet creation, signing or network call on mount.
 * children(driver,{ready,authenticated}) renders the application's explicit controls.
 */
export function PrivyStellarBridge({stellar,networkPassphrase,children,onDriver}){
 const {ready,authenticated,user}=usePrivy();
 const {createWallet}=useCreateWallet();
 const {signRawHash}=useSignRawHash();
 const current=useRef({});current.current={ready,authenticated,user,createWallet,signRawHash};
 const active=useRef(true);
 const driver=useMemo(()=>createPrivyDriver({
  stellar,networkPassphrase,
  getSession:()=>{const s=current.current;return {ready:active.current&&s.ready,authenticated:active.current&&s.authenticated,userId:s.user?.id,wallets:(s.user?.linkedAccounts??[]).filter(x=>x.type==="wallet").map(x=>({address:x.address,chainType:x.chainType,walletClientType:x.walletClientType}))};},
  createWallet:async input=>{const before=current.current.user?.id;const result=await current.current.createWallet(input);if(active.current&&current.current.user?.id===before&&result.user?.id===before)current.current={...current.current,user:result.user};return result;},
  signRawHash:input=>current.current.signRawHash(input)
 }),[stellar,networkPassphrase]);
 useEffect(()=>{active.current=true;onDriver?.(driver);return()=>{active.current=false;onDriver?.(null);};},[driver,onDriver]);
 return typeof children==="function"?children(driver,{ready,authenticated}):null;
}
