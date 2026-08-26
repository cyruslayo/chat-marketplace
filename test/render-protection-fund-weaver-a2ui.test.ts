import test from "node:test";
import assert from "node:assert/strict";
import { protectionFundArtifact } from "../apps/web/src/protection-fund-artifact.js";
import { protectionFundArtifactToA2UI } from "../apps/web-agent/src/protection-fund-a2ui.js";
import { createProtectionFundWebAgentAdapter } from "../apps/web-agent/src/presentation.js";
import { ProtectionFundApplication } from "../apps/web/src/protection-fund-application.js";
import { InMemoryProtectionFundAccountingRepository } from "../domains/shortlet/src/protection-fund-accounting.js";
const p={id:"finance",role:"authorized_staff" as const};
function make(){const accounting=new InMemoryProtectionFundAccountingRepository();return new ProtectionFundApplication({accounting,metrics:{getMetrics:()=>({metricsVersion:"m1",projectedP95NetRemedyExposureKobo:0,projectedNext90DayGbvKobo:0,trailing90DayGbvKobo:0,trailingP95NetRemedyExposureKobo:0})},capital:{allocateOrGet:i=>({allocationId:"a",allocationVersion:"1",status:"settled",amountKobo:i.requiredAmountKobo,currency:"NGN"})},commissions:{getEarnedCommission:()=>null},remedies:{getRemedy:()=>{throw Error("unused")}},recovery:{getRecovery:()=>{throw Error("unused")}},financeAuthorization:{canView:()=>true}});}
test("Protection Fund Finance artifact maps to Weaver Basic Catalog read-only",()=>{const artifact=protectionFundArtifact(make(),p);const messages=protectionFundArtifactToA2UI({artifact,surfaceId:"surface-1"});assert.equal(messages[0].version,"v0.9.1");assert.equal(artifact.actions.length,0);assert.equal(JSON.stringify(messages).includes("guest"),false);});
test("Protection Fund Web Agent adapter uses the canonical artifact",()=>{const result=createProtectionFundWebAgentAdapter({application:make(),principal:p,createSurfaceId:id=>`surface:${id}`}).get();assert.equal(result.artifact.kind,"shortlet.protection-fund");assert.equal(result.fallback.conventionalRoute,"/finance/guest-protection-fund");});
