/* VT ENGINE — Vehicle Tracking analytics (Spec Kit 071, specs/071-vehicle-tracking-analytics/).
 *
 * THE ENGINE DECIDES, THE PAGE PAINTS. Every VT figure, status, rate, rating and verdict is
 * computed here and nowhere else: PULSE's VT pages, the published digest, the Worker and Agent
 * Analytics only carry and paint what this file returns. Pure functions only — no DOM, no fetch,
 * no clock (every "today" is passed in), the input book is never mutated.
 *
 * Loads two ways (plan "companion-file pattern"): a classic <script src="vt-engine.js" data-inline>
 * from PULSE (works from file://; prepare-site inlines it) → window.VTEngine, and require() in the
 * Node suites → module.exports.
 *
 * Rules: VT_RULES below is the operative copy of specs/vt_engine_rules.json — change both together
 * with a dated _changes[] entry; diagnostics/verify-vt-rules.mjs fails on drift and on any rule
 * literal written outside the @vt-rules block.
 *
 * Pipeline:  detect → parseBi / parseSm / parseSchedulers (PII dropped here) → merge (case book +
 * events, FR-011..015) → model (MTD / weeks / days at agent, TL, sub-campaign, lead source, floor)
 * → rating (spec §6) → digest (plan §P).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.VTEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

/* @vt-rules start */
var VT_RULES = {
  "version": "vt-1.4",
  "detection": {
    "vtBiFitted": {
      "requireHeaders": ["installation status","vehicle reg number","box number","unit type","case number","created by"],
      "nameHint": "fitted",
      "runBefore": ["bi","inactive"],
      "footerPattern": "^Applied filters:"
    },
    "vtSchedMissed": {"requireHeaders":["missedandscheduledfitment","fitment date","case number","created by"],"footerPattern":"^No filters applied"},
    "vtSchedulers": {
      "sheetName": "Schedulers Data",
      "requireHeaders": ["month","date","agent","case number","result"],
      "readColumns": ["date","agent","sale count","gwp","case number","campaign/partner","referring agent","scheduler","result","date scheduled"],
      "takeOnly": ["case number","date","gwp","campaign/partner","referring agent","scheduler","result","date scheduled"],
      "optional": false,
      "reUploadable": true,
      "retiredName": "vtOpeningBook (spec 071) - the same sheet, which only took the sale date; the kind 'opening_book' stays legal on stored rows and old receipts"
    },
    "filenameDate": {"pattern":"(\\d{2})(\\d{2})(\\d{2})(?=\\D*\\.xlsx?$)","order":"ddmmyy","century":2000,"fallback":"todaySAST+warning"},
    "refuseIn": ["ops.detectSource","pulse.rakeDetect","relay.archiveUpload"]
  },
  "columns": {
    "bi": {
      "byPosition": true,
      "caseNumber": "AS",
      "unitType": "Y",
      "bundle": "Z",
      "chargeEx": "X",
      "chargeCheck": "AD",
      "installedOn": "Q",
      "contractCreatedOn": "O",
      "createdBy": "L",
      "sourcePartner": "AP",
      "contractStatus": "B",
      "deactivateOn": "P"
    },
    "biOptional": ["contractStatus","deactivateOn"],
    "sm": {"caseNumber":"C","productType":"J","attempt":"L","bundle":"M","apptOn":"R","createdBy":"S","outcome":"U","sourcePartner":"A"},
    "schedulers": {
      "byPosition": true,
      "saleDate": "B",
      "agent": "C",
      "saleCount": "D",
      "gwp": "E",
      "caseNumber": "F",
      "campaignRaw": "H",
      "referringAgent": "I",
      "scheduler": "J",
      "result": "K",
      "apptOn": "M",
      "discard": ["A","G","L","N","O","P","Q","R"],
      "resultIsNeverApplied": true
    },
    "discardAll": "every column not listed above — including Schedulers Data col G 'Customer Contact' — plus customer name, mobile, registration, chassis, box, account/contract numbers, consultants, fitment partner and last modified by",
    "dateSerial": "Excel 1900 serial, integer part; text dates refused"
  },
  "vtUnitTypes": ["BEAME","MXV","Matrix Vision"],
  "status": {
    "values": ["scheduled","missed","fitted","cancelled"],
    "fromBi": "fitted",
    "fromSm": {"Scheduled Fitment":"scheduled","Missed Fitment":"missed"},
    "sameExtractPrecedence": ["cancelled","fitted","missed","scheduled"],
    "acrossExtracts": "newer extract decides between missed and scheduled",
    "terminal": ["fitted"],
    "open": ["scheduled","missed"],
    "sticky": true,
    "olderExtractMayChangeStatus": false,
    "cancelledFrom": ["dropped","deactivated"],
    "cancellation": {
      "reasons": ["dropped","deactivated"],
      "dropped": {
        "from": ["scheduled","missed"],
        "completeDay": ["bi_fitted","sched_missed"],
        "absentFrom": "both files of the extract day",
        "trigger": "the commit of the second file of an extract day, only when no later extract day is complete",
        "onDate": "that extract day",
        "returns": "seen again in a file of that extract day or later: takes that file's status"
      },
      "deactivated": {
        "from": "bi",
        "when": "Contract Deactivate Date (P) not blank, or Contract Status (B) not blank and not activeStatus",
        "activeStatus": "Active",
        "onDate": "the deactivate date, never before the case's previous status day nor after the extract day; no date: the extract day",
        "winsOverFitted": true,
        "returns": "a newer BI row that is Active with no deactivate date: fitted"
      },
      "fitDoneKeepsInstall": true
    }
  },
  "saleDay": {
    "basis": "first_seen",
    "basisPrecedence": ["schedulers_data","opening_book","first_seen"],
    "schedulersData": "takes Schedulers Data col B for its cases and outranks both other bases (plan U-4)",
    "openingBook": "RETIRED (spec 072 U-1): the 071 opening book took the same sheet's col B. Stored rows keep the basis, which still outranks first_seen",
    "openingWithoutDate": "null - in play, never counted as a sale on any day",
    "goLive": "unknown",
    "saleDateColumn": null
  },
  "fittedDay": {"from":["bi.installedOn","bi.contractCreatedOn"]},
  "apptDay": {"from":"sm.apptOn"},
  "identity": {
    "sellerFrom": ["sm.createdBy","bi.createdBy"],
    "stripSuffixes": [" - Panimax"],
    "collapseWhitespace": true,
    "caseFold": true,
    "chain": ["exact","alias","near","first_last"],
    "nearMinTokenLength": 4,
    "unmatched": "excluded from agent rows; counted on the receipt and in floor.unmatched",
    "creditOverrides": {}
  },
  "leadSources": {
    "map": {
      "RevX": "revx",
      "Tracking Empire / Shawn Langley": "tracking_empire",
      "Jag Web Marketing- Panimax": "jag",
      "Afrilead- Panimax": "afrilead",
      "Sales Enablement": "sales_enablement",
      "Panimax - New Sales": {"ifSellerTeam":{"referral":"referral"},"else":"predictive"}
    },
    "unknown": "other",
    "groups": {"lead_gen":["revx","tracking_empire","jag","afrilead"],"predictive":["predictive"],"referral":["referral"],"other":["sales_enablement","other"]},
    "labels": {
      "revx": "Revx",
      "tracking_empire": "Tracking Empire",
      "jag": "Jag",
      "afrilead": "Afrilead",
      "predictive": "Predictive",
      "referral": "Referral",
      "sales_enablement": "Sales Enablement",
      "other": "Other",
      "lead_gen": "Lead Gen"
    }
  },
  "teams": {
    "fromCampaignRaw": "^Matrix Vehicle Tracking - (Digital|Predictive|Referral|Scheduling)\\s*$",
    "keys": {"Digital":"digital","Predictive":"predictive","Referral":"referral","Scheduling":"scheduling"},
    "notRated": ["scheduling"],
    "noTarget": "Target <= 0, '-' or blank"
  },
  "periods": {
    "periodStartDay": 26,
    "cycleKeyBy": "month the cycle ends in (cycle-YYYY-MM, worker/src/cycle.mjs)",
    "weekStart": "Mon",
    "weekEnd": "Sat",
    "sundayJoins": "week of the preceding Monday",
    "weeksClippedToCycle": true,
    "workingDay": "Mon-Fri and not dataOnlyDay (SA public holidays + extraHolidays)",
    "extraHolidays": ["2026-11-04"],
    "saturday": "data, not a working day",
    "hrsAheadAsAtOffsetDays": 1,
    "hrsAheadBasis": "frozen: hrsAsAt = latest extract + hrsAheadAsAtOffsetDays. NEVER TODAY(). Decision D5.",
    "weekWindow": "date >= week start AND date < week start + 7",
    "leadTimeBuckets": [
      {"k":"h24","label":"24","days":0},
      {"k":"h48","label":"48","days":1},
      {"k":"h72","label":"72","days":2},
      {"k":"h72pIn","label":"72+ in cycle","minDays":3,"cutoff":"cycle.to","cutoffOp":"<="},
      {"k":"h72pOut","label":"72+ out cycle","minDays":3,"cutoff":"cycle.to","cutoffOp":">"},
      {"k":"past","label":"Past due","maxDays":-1}
    ]
  },
  "guards": {"thinBiShare":0.9,"thinSmShare":0.4,"uploadGapWorkingDays":1},
  "vat": 1.15,
  "reports": {
    "inPlay": "sold in cycle OR (sold earlier AND (open at any time in cycle OR fitted in cycle))",
    "columns": [
      {"id":"sales","label":"Sales","f":"count(set)","basis":"saleDay; MTD = inPlay"},
      {"id":"current","label":"Current","f":"count(set where saleDay >= cycle.from)","basis":"saleDay","mtdOnly":true},
      {"id":"rollover","label":"Rollover","f":"count(set where saleDay < cycle.from or saleDay null)","basis":"saleDay","mtdOnly":true},
      {"id":"fitted","label":"Fitted","f":"count(set where status=fitted)","basis":"status as at"},
      {"id":"scheduled","label":"Scheduled","f":"count(set where status=scheduled)","basis":"status as at"},
      {"id":"missed","label":"Missed","f":"count(set where status=missed)","basis":"status as at"},
      {
        "id": "cancelled",
        "label": "Cancelled",
        "f": "count(set where status=cancelled); 0 when none",
        "basis": "status as at (the event's day: the complete extract day it dropped out, or the deactivate date)"
      },
      {"id":"fitRate","label":"Fitted Rate %","f":"fitted / sales"},
      {"id":"missRate","label":"Missed Rate %","f":"missed / sales"},
      {"id":"schedRate","label":"Scheduled Rate %","f":"scheduled / sales"},
      {"id":"canRate","label":"Cancellation %","f":"cancelled / sales"},
      {"id":"fitDone","label":"Fitments done","f":"count(cases fitted, or fitted and later deactivated, fittedDay in window)","basis":"fittedDay"},
      {"id":"missAppt","label":"Missed appointments","f":"count(events to=missed, apptDay in window)","basis":"apptDay"},
      {"id":"due","label":"Due to fit","f":"count(open scheduled, apptDay in window)","basis":"apptDay"},
      {"id":"hrsAhead","label":"Hrs Ahead 24/48/72/72+/Past due","f":"bucket(apptDay - asAt) over open scheduled","basis":"asAt","mtdOnly":true},
      {"id":"hrsShare","label":"Hrs Ahead share vs budget","f":"bucket / open scheduled","mtdOnly":true,"levels":["team","sub","floor"]},
      {"id":"workingDays","label":"Working days","f":"working days from max(cycle.from, agent start, first tracked day) to last extract"},
      {"id":"spd","label":"SPD","f":"current / workingDays"},
      {"id":"target","label":"Target SPD","f":"Agent List Target; team = sum"},
      {"id":"toTarget","label":"% to target","f":"spd / target; teams: sum(current of targeted agents) / sum(target x workingDays)"},
      {"id":"fitBudget","label":"Fitment budget %","f":"budgets[cycle].fitment[sub][tenure]"},
      {"id":"canBudget","label":"Cancellation budget %","f":"budgets[cycle].cancelled[sub]"},
      {"id":"value","label":"Fitted value (incl VAT, Charge Amount basis)","f":"sum(chargeEx of fitted) * vat","basis":"fittedDay"},
      {"id":"noSaleDay","label":"Sales without a sale day","f":"count(set where saleDay null)","mtdOnly":true,"showWhenPositive":true}
    ],
    "totals": "sum of counts; rates = ratio of sums",
    "absent": "—",
    "schedulerPivots": {
      "built": true,
      "scopes": ["referral","predictive","lead_gen","all"],
      "scope": "allData",
      "percentBase": "schedulerGrandTotal",
      "outcomes": ["fitted","scheduled","cancelled","missed"],
      "divideByZeroSafe": true
    },
    "personDimensions": [
      {"k":"agent","label":"Agent","from":"the engine's resolved seller (Salesforce Created By)"},
      {"k":"referrer","label":"Referring Agent","from":"Schedulers Data col I, where it is not 0"},
      {"k":"scheduler","label":"Scheduler","from":"Schedulers Data col J"}
    ],
    "gwp": {
      "fitted": "sum of Schedulers Data col E where status == fitted",
      "total": "sum of Schedulers Data col E in view",
      "lost": "sum of Schedulers Data col E where status in (cancelled, missed)",
      "source": "Schedulers Data col E, hand-typed, whole rand",
      "notSource": "NOT the engine's BI Fitted value (charge ex VAT x vat), which is a different measure (spec A7). Both are shown, each named; neither is adjusted to match the other."
    },
    "upcomingFitments": {
      "startAt": "MINIFS(apptOn where status == scheduled)",
      "countPerDate": "cases with that apptOn and status scheduled",
      "sharePerDate": "count / total scheduled pipeline",
      "horizonDays": 16,
      "tailLabel": "Later dates / not shown",
      "scope": "all bookings including rollovers, regardless of view"
    },
    "rolloverFollowUp": {
      "columns": ["sales","fitted","scheduled","cancelled","missed","open","fittedPct","openPct","gwpFitted","gwpOpen"],
      "openToAction": "scheduled + cancelled + missed",
      "alwaysPreCycle": true
    }
  },
  "rating": {
    "floor": 0.5,
    "window": "cycle-to-date (cycle.from → last extract)",
    "minCases": 5,
    "minTrackedDays": 5,
    "minInPlayToRate": 1,
    "renormalise": true,
    "lowerIsBetter": "att = clamp(target / value, 0, 1); value 0 → 1 (kept in the engine; no driver uses it since vt-1.2)",
    "points": "round(w * clamp((att - floor) / (1 - floor), 0, 1), 1)",
    "score": "round(min(100, sum(points) / sum(measured w) * 100), 1)",
    "penalties": 0,
    "drivers": [
      {
        "k": "targetAch",
        "label": "Target Achievement",
        "w": 50,
        "dir": "higher",
        "value": "reports.spd",
        "target": "Agent List Target (AL VT!I) for the cycle's list",
        "note": "How close your sales per working day come to your target."
      },
      {
        "k": "fitRate",
        "label": "Fitment Rate",
        "w": 50,
        "dir": "higher",
        "value": "reports.fitRate (MTD in play)",
        "target": "budgets[cycle].fitment[sub][tenure]",
        "note": "Out of every 100 of your sales in play this month, how many are fitted. A missed or cancelled sale is a sale not fitted, so it counts here, once."
      }
    ],
    "info": ["missed","missRate","missBudget","cancelled","canRate","canBudget","fitDone"],
    "notScored": {
      "gwp": "D7-a: Charge Amount x VAT equals RPT GWP on 328/1,104; budget Avg GWP is on the bundle-price basis; SM has no amount",
      "hrsAhead": "D7-b: scheduler's queue, not the seller's",
      "attendance_talk_qa_conversion_optins": "D7-c: not in the VT files",
      "schedulers": "D7-d",
      "missRate": "vt-1.2: removed as a driver - double counting of Fitment Rate (a missed sale is a sale not fitted); shown on the card beside the missed budget, unscored",
      "fittedVsTarget": "vt-1.2: removed as a driver - target x working days x fitment budget re-scores Target Achievement x Fitment Rate; fitments done shown on the card, unscored",
      "cancellations": "R7: shown beside the cancellation budget, never scored; a cancelled sale is still a sale and is not fitted, so it lowers Fitment Rate"
    },
    "bands": [{"label":"Elite","min":90},{"label":"Strong","min":80},{"label":"On track","min":70},{"label":"Building","min":60},{"label":"Needs support","min":0}]
  },
  "budgetFallback": "latest earlier cycle; the card names the cycle used",
  "channels": {
    "keys": ["lead_gen","referral","predictive","other"],
    "labels": {"lead_gen":"Lead Gen","referral":"Referral","predictive":"Predictive","other":"Other"},
    "salesReviewLabels": {"lead_gen":"Digital","referral":"Referrals","predictive":"Predictive","other":"Other"},
    "campaignMap": {
      "Revx": "lead_gen",
      "Tracking Empire": "lead_gen",
      "Jag": "lead_gen",
      "Afrilead": "lead_gen",
      "Referral Agent": "referral",
      "Predictive": "predictive",
      "Black Birch Projects": "other"
    },
    "unmapped": "other",
    "blankCampaign": "blank, never Other",
    "rollups": {"panimax":{"label":"Panimax","members":["referral","predictive"],"neverDoubleCounted":true}},
    "dimension": "lead source (leadAgg / lead groups), NOT the agent's sub-campaign (subAgg)"
  },
  "views": {
    "default": "cycle",
    "list": [
      {
        "k": "cycle",
        "label": "Cycle view (current + fitted rollovers)",
        "words": "Sales dated in the cycle, plus earlier sales only where they were fitted",
        "dateRule": "date >= cycle.from AND date <= cycle.to",
        "preCycle": {"include":true,"onlyStatus":"fitted"},
        "openOutcomesInCycleOnly": true
      },
      {
        "k": "current",
        "label": "Current cycle sales only",
        "words": "Sales dated in the cycle",
        "dateRule": "date >= cycle.from AND date <= cycle.to",
        "preCycle": {"include":false,"onlyStatus":null},
        "openOutcomesInCycleOnly": true
      },
      {
        "k": "rollovers",
        "label": "Rollovers only",
        "words": "Sales dated before the cycle start",
        "dateRule": "date < cycle.from",
        "preCycle": {"include":true,"onlyStatus":null},
        "openOutcomesInCycleOnly": false
      },
      {"k":"all","label":"All data","words":"All sales to date","dateRule":"date is a real date","preCycle":{"include":true,"onlyStatus":null},"openOutcomesInCycleOnly":false}
    ],
    "alwaysAllBookings": ["leadTime","upcomingFitments"],
    "rollover": {
      "isRollover": "date < cycle.from",
      "fittedCountsInCycle": true,
      "openToAction": ["scheduled","cancelled","missed"],
      "openNeverCountsAsNewCycleSale": true,
      "preCycleWeeksAreFittedOnly": "in cycle view a pre-cycle week's fitted share reads 100 % by construction and must be labelled so nobody reads it as a real week"
    }
  },
  "cycleBudget": {
    "cycle-2026-11": {
      "headcount": 6,
      "sales": {"lead_gen":2066,"referral":179,"predictive":785,"total":3030},
      "fitments": {"lead_gen":1653,"referral":143,"predictive":628,"total":2424},
      "fitmentRate": {"*":0.8},
      "cancelledPct": {"*":0.05},
      "missedPct": {"*":0.05},
      "scheduledPct": {"*":0.1},
      "dialingDays": 22,
      "salesBudgetIsTheOnlyBudget": true,
      "cells": {
        "headcount": "Sales Review B50 (actual C50 = 6 distinct schedulers)",
        "sales": "Sales Review B51 total 3030 = SUM(B52:B54); B52 Digital 2066, B54 Panimax = B55+B56, B55 Referrals 179, B56 Predictive 785",
        "fitments": "Sales Review B57 total 2424 = SUM(B58:B60); B58 Digital 1653, B61 Referrals 143, B62 Predictive 628",
        "fitmentRate": "Sales Review B63 total 0.8 — flat 80 % on every channel (B64 Digital, B66 Panimax, B67 Referrals, B68 Predictive)",
        "cancelledPct": "Sales Review B81 total 0.05 (B82/B84/B85/B86 0.05); the count budgets B76 = 0.05*B52, B79 = 0.05*B55, B80 = 0.05*B56",
        "missedPct": "Sales Review B70 = 0.05*B52, B73 = 0.05*B55, B74 = 0.05*B56",
        "scheduledPct": "Sales Review B88 = 0.1*B52, B91 = 0.1*B55, B92 = 0.1*B56",
        "dialingDays": "Sales Review B49 = NETWORKDAYS(K5,K6,K9:K14) = 22 for 26 Oct - 25 Nov 2026 with 4 Nov a holiday"
      }
    },
    "fallback": "latest earlier cycle; the panel names the cycle used, exactly as budgetFallback does for the rating"
  },
  "dashboardHrsShare": {
    "h24": 0.75,
    "h48": 0.1,
    "h72": 0.05,
    "h72pIn": 0.05,
    "h72pOut": 0.05,
    "base": "the channel's scheduled target = scheduledPct x that channel's sales budget",
    "notTheRatingShare": "budgets[cycle].hrsShare (h24 0.8, h48 0.1, h72 0.05, h72p 0.05) comes from Sales_Review_YTD 2026.xlsx and stays unchanged. Neither share is scored (rating.notScored.hrsAhead).",
    "structuralZero": "h72pIn is unreachable in the last three days of a cycle — its rule is '3+ days ahead AND on or before the cycle end', so from the 23rd nothing can land in it. It is 0 on the owner's file for that reason, and its 5 % share cannot be hit. Open question Q4.",
    "cells": {"h24":"Sales Review B94 = 0.75*B88","h48":"B100 = 0.1*B88","h72":"B106 = 0.05*B88","h72pIn":"B112 = 0.05*B88","h72pOut":"B118 = 0.05*B88"}
  },
  "forecast": {
    "method": "straight_line_pace",
    "formula": "actual / elapsedDialingDays * totalDialingDays",
    "totalDialingDays": "workingDaysBetween(cycle.from, cycle.to)",
    "elapsedDialingDays": "workingDaysBetween(cycle.from, dataThrough)",
    "dataThrough": "MIN(cycle.to, latest sale date in the book)",
    "holidays": "periods.extraHolidays + saHolidaysFor(year) — the rule book's list, which already holds 2026-11-04 and already equals MTD_RULES.extraHolidays",
    "appliesTo": ["sales","fitments"],
    "notAppliedTo": ["missed","cancelled","scheduled","leadTimeBuckets"],
    "label": "straight-line pace, not a prediction",
    "cells": {
      "formula": "Sales Review F51 / F57 = IFERROR(C51/$C$49*$B$49,'')",
      "totalDialingDays": "Sales Review B49",
      "elapsedDialingDays": "Sales Review C49",
      "dataThrough": "Sales Review K7 = MIN(K6, MAX(col B))",
      "holidays": "Sales Review K9:K14 (K9 = 2026-11-04, K10:K14 blank)"
    }
  },
  "integrity": [
    {
      "k": "k17",
      "label": "Outcomes = total sales",
      "formula": "fitted + scheduled + missed + cancelled == sales",
      "okWords": "Fitted, scheduled, missed and cancelled add up to total sales",
      "checkWords": "{got} outcomes against {expected} sales - a difference of {diff}",
      "cell": "Sales Review K17 = IF(SUM(B43:E43)=F43,'OK','CHECK')"
    },
    {
      "k": "k18",
      "label": "Lead-time buckets = scheduled",
      "formula": "h24 + h48 + h72 + h72pIn + h72pOut == scheduled",
      "okWords": "The five lead-time buckets add up to the scheduled pipeline",
      "checkWords": "{got} in buckets against {expected} scheduled - a difference of {diff}; look for a scheduled case with no appointment date",
      "cell": "Sales Review K18 = IF(C93+C99+C105+C111+C117=C87,'OK','CHECK')"
    },
    {
      "k": "schedulerName",
      "label": "Every sale has a scheduler",
      "formula": "sum of per-scheduler sales == sales in view",
      "okWords": "Reconciles to total sales in view",
      "checkWords": "Check: {diff} sales in view have no scheduler name",
      "cell": "Agent & Scheduler Summary E36"
    }
  ],
  "insights": {
    "templates": [
      {
        "id": "conversion",
        "requires": ["sales","fitted","scheduled"],
        "text": "Conversion: {fitRate} of {sales} sales in view are fitted, and a further {scheduled} ({schedRate}) are booked.",
        "cell": "Exco Summary B11"
      },
      {
        "id": "leakage",
        "requires": ["cancelled","missed","sales"],
        "text": "Leakage: {leak} sales ({leakRate}) were cancelled or missed, representing R{leakGwp} of GWP.",
        "cell": "Exco Summary B12"
      },
      {
        "id": "bestCampaign",
        "requires": ["campaigns"],
        "minSales": 20,
        "text": "Campaigns with {minSales}+ sales: best fitted rate {best} ({bestRate}), lowest {worst} ({worstRate}).",
        "cell": "Exco Summary B13"
      },
      {
        "id": "rollovers",
        "requires": ["rollovers"],
        "text": "Rollovers (sold before {cycleFrom}): {total} in total; {fitted} fitted and counted in this cycle, {open} still open - {scheduled} scheduled, {rebook} to rebook.",
        "cell": "Exco Summary B14"
      }
    ],
    "rules": {
      "computedOnly": "no insight may be hand-written; each names the figure and the cell it came from",
      "omitWhenAbsent": "a template whose requires[] are not all present is omitted, never padded with a zero",
      "minSalesApplies": "a template with minSales is omitted when no member clears it"
    }
  },
  "disagree": {
    "resultApplied": false,
    "words": "The Schedulers Data Result column is hand-typed and is not the system of record: it is parsed, compared and counted by direction, and never applied. Every count here is a count with words, never a hidden adjustment.",
    "carried": {
      "handCredits": 11,
      "leadSourceRelabelledShare": "6.6 %",
      "words": "Carried forward from the 071 floor guide: 11 sales the hand report credits to someone other than the Salesforce Created By, and about 6.6 % of rows whose lead source the hand report relabels. The engine keeps Salesforce as the system of record for both."
    }
  },
  "budgets": {
    "cycle-2026-11": {
      "spd": {"digital":{"*":6.5},"referral":{"*":3},"predictive":{"Exp":2,"M2":1.5,"M1":1}},
      "fitment": {"digital":{"*":0.85},"referral":{"*":0.85},"predictive":{"*":0.8,"Exp":0.8,"M2":0.75,"M1":0.7},"floor":0.8},
      "missed": {"*":0.05},
      "cancelled": {"*":0.05},
      "hrsShare": {"h24":0.8,"h48":0.1,"h72":0.05,"h72p":0.05},
      "avgGwpShownNotScored": {"digital":166,"referral":199,"predictive":169}
    }
  }
};
/* @vt-rules end */

/* @mirror:sa-holidays start — identical in nicks_code/index.html and agent/index.html; verify-public-holidays.mjs fails on any difference */
/* SA PUBLIC HOLIDAYS, COMPUTED (Public Holidays Act 36 of 1994): the ten fixed dates, Good
   Friday and Family Day from the Gregorian Easter algorithm (Meeus/Jones/Butcher), and a
   holiday that falls on a Sunday observed on the Monday. Returns the OBSERVED dates for the
   year as 'YYYY-MM-DD' strings — the table this replaces had to be extended every December
   and would have silently gone blank in a January. One-off holidays the Act does not list
   (an election day) are added by the caller from the rule book, never here. */
function saHolidaysFor(year){
  var y=+year, a=y%19, b=Math.floor(y/100), c=y%100, d=Math.floor(b/4), e=b%4, f=Math.floor((b+8)/25),
      g=Math.floor((b-f+1)/3), h=(19*a+b-d-g+15)%30, i=Math.floor(c/4), k=c%4, l=(32+2*e+2*i-h-k)%7,
      m=Math.floor((a+11*h+22*l)/451), em=Math.floor((h+l-7*m+114)/31), ed=((h+l-7*m+114)%31)+1;
  var easter=Date.UTC(y,em-1,ed), DAY=864e5;
  var iso=function(t){ return new Date(t).toISOString().slice(0,10); };
  var days=[Date.UTC(y,0,1),Date.UTC(y,2,21),easter-2*DAY,easter+DAY,Date.UTC(y,3,27),Date.UTC(y,4,1),
            Date.UTC(y,5,16),Date.UTC(y,7,9),Date.UTC(y,8,24),Date.UTC(y,11,16),Date.UTC(y,11,25),Date.UTC(y,11,26)];
  var out=[]; for(var n=0;n<days.length;n++){ var t=days[n]; if(new Date(t).getUTCDay()===0) t+=DAY; out.push(iso(t)); }
  return out;
}
/* @mirror:sa-holidays end */

var R = VT_RULES, DAY = 864e5, EXCEL_EPOCH = 25569;

/* ---------------------------------------------------------------- small helpers ---- */
function iso(t) { return new Date(t).toISOString().slice(0, 10); }
function addDays(d, n) { return iso(Date.parse(d + 'T00:00:00Z') + n * DAY); }
function dayDiff(a, b) { return Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / DAY); }
function dow(d) { return new Date(d + 'T00:00:00Z').getUTCDay(); }
function maxD() { var m = null; for (var i = 0; i < arguments.length; i++) if (arguments[i] && (!m || arguments[i] > m)) m = arguments[i]; return m; }
function minD() { var m = null; for (var i = 0; i < arguments.length; i++) if (arguments[i] && (!m || arguments[i] < m)) m = arguments[i]; return m; }
function round(x, dp) { var f = Math.pow(10, dp); return Math.round(x * f) / f; }
function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase(); }
function copy(o) { var r = {}; for (var k in o) r[k] = Array.isArray(o[k]) ? o[k].slice() : o[k]; return r; }
function sortedKeys(o) { return Object.keys(o).sort(); }
function serialToISO(n) { return (typeof n === 'number' && isFinite(n) && n > 0) ? iso((Math.floor(n) - EXCEL_EPOCH) * DAY) : null; }
function cnKey(v) { var s = String(v == null ? '' : v).trim(); return /^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, '') : ''; }
var ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function colIndex(letters) { var n = 0; for (var i = 0; i < letters.length; i++) n = n * ALPHA.length + ALPHA.indexOf(letters[i]) + 1; return n - 1; }
function normCB(v) { var m = String(v == null ? '' : v).trim().match(/^cb\s*-?\s*0*(\d+)$/i); return m ? 'CB' + m[1] : null; }
function union(a, b) { var s = {}; (a || []).concat(b || []).forEach(function (x) { if (x) s[x] = 1; }); return Object.keys(s).sort(); }

/* ---------------------------------------------------------------- periods ---- */
function cycleOf(d) {
  var y = +d.slice(0, 4), m = +d.slice(5, 7), day = +d.slice(8, 10), S = R.periods.periodStartDay;
  if (day >= S) { m += 1; if (m > 12) { m = 1; y += 1; } }
  return cycleByKey('cycle-' + y + '-' + String(m).padStart(2, '0'));
}
function cycleByKey(key) {
  var y = +key.slice(6, 10), m = +key.slice(11, 13), S = R.periods.periodStartDay;
  var from = iso(Date.UTC(y, m - 2, S)), to = iso(Date.UTC(y, m - 1, S - 1));
  return { key: key, from: from, to: to };
}
var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function short(d) { return (+d.slice(8, 10)) + ' ' + MON[+d.slice(5, 7) - 1]; }
function mondayOf(d) { return addDays(d, -((dow(d) + 6) % 7)); }
/* Weeks run Monday–Saturday; a Sunday joins the week of the Monday before; clipped to the cycle. */
function weekKeyOf(d, cyc) { return maxD(mondayOf(d), cyc.from); }
function weeksOf(cyc) {
  var out = [], d = cyc.from;
  while (d <= cyc.to) {
    var from = d, sun = addDays(mondayOf(d), 6), to = minD(sun, cyc.to), sat = minD(addDays(mondayOf(d), 5), cyc.to);
    out.push({ k: from, from: from, to: to, label: short(from) + ' – ' + short(sat < from ? from : sat) });
    d = addDays(to, 1);
  }
  return out;
}
var _HOL = {};
function defaultDataOnly(d) {
  var y = d.slice(0, 4), set = _HOL[y] || (_HOL[y] = saHolidaysFor(+y));
  return dow(d) === 6 || set.indexOf(d) > -1 || (R.periods.extraHolidays || []).indexOf(d) > -1;
}
/* A working day is Mon–Fri and not a data-only day. PULSE hands its own dataOnlyDay in, so the VT
   calendar is the VAS calendar; Node uses the same computed calendar + the rule book's one-offs. */
function isWorkingDay(d, isDataOnlyDay) { var w = dow(d); return w > 0 && w < 6 && !(isDataOnlyDay || defaultDataOnly)(d); }
function workingDaysBetween(a, b, isDataOnlyDay) { var n = 0; for (var d = a; a && b && d <= b; d = addDays(d, 1)) if (isWorkingDay(d, isDataOnlyDay)) n++; return n; }
function hrsAsAt(extractOn) { return addDays(extractOn, R.periods.hrsAheadAsAtOffsetDays); }
/* THE LEAD-TIME BUCKET (072 D5/D6, rule book periods.leadTimeBuckets). Five buckets ahead plus Past
   due: 24 / 48 / 72 are exact day offsets from the FROZEN as-at (never a clock), and a booking three
   or more days out splits on the cycle end — `72+ in cycle` on or before it, `72+ out cycle` after.
   `cycleTo` is the cycle end from periods.cycleByKey (FR-032), never the workbook's TODAY() expression;
   every caller in this file passes it. Omitted, it falls back to the cycle the as-at date sits in,
   which is a safety net and not the contract — a caller that knows its cycle must say so. */
function hrsBucket(apptOn, asAt, cycleTo) {
  if (!apptOn || !asAt) return null;
  var diff = dayDiff(apptOn, asAt), B = R.periods.leadTimeBuckets, end = cycleTo || cycleOf(asAt).to;
  for (var i = 0; i < B.length; i++) {
    var b = B[i];
    if (b.days != null && diff === b.days) return b.k;
    if (b.minDays != null && diff >= b.minDays) {
      if (!b.cutoff) return b.k;
      if (b.cutoffOp === '>' ? apptOn > end : apptOn <= end) return b.k;
      continue;
    }
    if (b.maxDays != null && diff <= b.maxDays) return b.k;
  }
  return null;
}
var periods = { cycleOf: cycleOf, cycleByKey: cycleByKey, weeksOf: weeksOf, weekKeyOf: weekKeyOf, isWorkingDay: isWorkingDay,
  workingDaysBetween: workingDaysBetween, hrsAsAt: hrsAsAt, hrsBucket: hrsBucket, addDays: addDays };

/* ---------------------------------------------------------------- detection + parse ---- */
/* Header names expected at each position the rule book reads (the files repeat Contract Status,
   Charge Amount and Unit Type, so BI is read by POSITION and each position is checked by name). */
var BI_NAMES = { caseNumber: 'case number', unitType: 'unit type', bundle: 'product bundle', chargeEx: 'charge amount', chargeCheck: 'charge amount',
  installedOn: 'installation date', contractCreatedOn: 'contract create date', createdBy: 'created by', sourcePartner: 'source partner' };
/* R4 (derived-cancellation fix): the two contract columns are OPTIONAL — read by position when the header there is the
   expected name, else by the first header of that name, else absent (no deactivation is ever inferred from a missing column). */
var BI_OPTIONAL = { contractStatus: 'contract status', deactivateOn: 'contract deactivate date' };
function optIndex(H, f) { var i = colIndex(R.columns.bi[f]); return H[i] === BI_OPTIONAL[f] ? i : H.indexOf(BI_OPTIONAL[f]); }
var SM_NAMES = { caseNumber: 'case number', productType: 'product type', attempt: 'status', bundle: 'bundle name', apptOn: 'fitment date',
  createdBy: 'created by', outcome: 'missedandscheduledfitment', sourcePartner: 'opportunity source partner' };

function detect(header, sheetName) {
  var h = (header || []).map(norm), has = function (list) { return list.every(function (x) { return h.indexOf(x) > -1; }); };
  var D = R.detection;
  if (has(D.vtBiFitted.requireHeaders)) return 'vtBiFitted';
  if (has(D.vtSchedMissed.requireHeaders)) return 'vtSchedMissed';
  if (has(D.vtSchedulers.requireHeaders) && (!sheetName || norm(sheetName) === norm(D.vtSchedulers.sheetName))) return 'vtSchedulers';
  return null;
}
/* THE BI HEADER IS SHARED (rule book vt-1.3, incident 2026-11-24): the VAS "BI Active" export and the Vehicle Tracking
   "BI Active Fitted" export have the same columns, so detect() saying vtBiFitted only means "one of the two". The
   uploader's slot decides, and the file NAME (detection.vtBiFitted.nameHint) is the fallback — this is that one test. */
function isBiFittedName(fileName) { return new RegExp(R.detection.vtBiFitted.nameHint, "i").test(String(fileName || "")); }
/* Extract date from the ddmmyy in the file name; else the caller's "today (SAST)", flagged. */
function extractDate(fileName, todaySAST) {
  var F = R.detection.filenameDate, m = String(fileName || '').match(new RegExp(F.pattern));
  if (m) {
    var d = +m[1], mo = +m[2], y = F.century + (+m[3]), t = Date.UTC(y, mo - 1, d);
    if (mo >= 1 && mo <= 12 && new Date(t).getUTCDate() === d) return { date: iso(t), assumed: false };
  }
  return { date: todaySAST || null, assumed: true };
}
function footer(cell, pattern) { return typeof cell === 'string' && new RegExp(pattern, 'i').test(cell.trim()); }
function blankRow(r) { return !r || r.every(function (v) { return v == null || v === ''; }); }
function dateCell(v, warn, what) { if (v == null || v === '') return null; if (typeof v === 'number') return serialToISO(v); warn(what + ' is text, not a date serial: ignored'); return null; }
function strCell(v) { var s = v == null ? '' : String(v).trim(); return s || null; }
function makeWarn() { var seen = {}, list = []; return { list: list, add: function (w) { if (!seen[w]) { seen[w] = 1; list.push(w); } } }; }

function parseBi(aoa) {
  var C = R.columns.bi, H = (aoa[0] || []).map(norm), idx = {}, missing = [];
  Object.keys(BI_NAMES).forEach(function (f) { var i = colIndex(C[f]); idx[f] = i; if (H[i] !== BI_NAMES[f]) missing.push(BI_NAMES[f] + ' (column ' + C[f] + ')'); });
  var out = { kind: 'bi', rows: 0, vtLines: 0, skippedFooter: 0, skippedBlank: 0, missing: missing, cases: {}, warnings: [] };
  if (missing.length) return out;
  var W = makeWarn(), VT = R.vtUnitTypes, foot = R.detection.vtBiFitted.footerPattern, D = R.status.cancellation.deactivated;
  (R.columns.biOptional || []).forEach(function (f) { idx[f] = optIndex(H, f); });
  out.deactivated = 0;
  for (var n = 1; n < aoa.length; n++) {
    var r = aoa[n]; if (blankRow(r)) continue;
    if (footer(r[0], foot)) { out.skippedFooter++; continue; }
    out.rows++;
    var cn = cnKey(r[idx.caseNumber]); if (!cn) { out.skippedBlank++; continue; }
    var unit = strCell(r[idx.unitType]); if (VT.indexOf(unit) < 0) continue;
    out.vtLines++;
    var x = +r[idx.chargeEx] || 0, chk = +r[idx.chargeCheck] || 0;
    if (Math.abs(x - chk) > 0.005) W.add('Charge Amount X differs from AD on a VT line: X used');
    var inst = dateCell(r[idx.installedOn], W.add, 'Installation Date'), con = dateCell(r[idx.contractCreatedOn], W.add, 'Contract Create Date');
    var c = out.cases[cn] || (out.cases[cn] = { products: [], bundle: null, chargeEx: 0, fittedOn: null, seller: null, partner: null, deactivated: false, deactivatedOn: null });
    /* a VT line deactivated (R4): a Deactivate Date, or a Contract Status that is not blank and not Active. The status text
       itself never leaves this function; only the flag and the date do. */
    var dOn = idx.deactivateOn > -1 ? dateCell(r[idx.deactivateOn], W.add, 'Contract Deactivate Date') : null;
    var cst = idx.contractStatus > -1 ? strCell(r[idx.contractStatus]) : null;
    var hasD = idx.deactivateOn > -1 && r[idx.deactivateOn] != null && r[idx.deactivateOn] !== '';
    if (hasD || (cst && cst !== D.activeStatus)) { if (!c.deactivated) out.deactivated++; c.deactivated = true; c.deactivatedOn = minD(c.deactivatedOn, dOn); }
    c.products = union(c.products, [unit]);
    c.bundle = c.bundle || strCell(r[idx.bundle]);
    c.chargeEx = round(c.chargeEx + x, 2);
    c.fittedOn = maxD(c.fittedOn, inst || con);
    c.seller = c.seller || normSeller(r[idx.createdBy]) || null;
    c.partner = c.partner || strCell(r[idx.sourcePartner]);
  }
  out.warnings = W.list;
  return out;
}
function byName(H, names) { var idx = {}, missing = []; Object.keys(names).forEach(function (f) { var i = H.indexOf(names[f]); idx[f] = i; if (i < 0) missing.push(names[f]); }); return { idx: idx, missing: missing }; }
function parseSm(aoa) {
  var H = (aoa[0] || []).map(norm), b = byName(H, SM_NAMES), idx = b.idx;
  var out = { kind: 'sm', rows: 0, lines: 0, skippedFooter: 0, skippedBlank: 0, missing: b.missing, cases: {}, warnings: [] };
  if (b.missing.length) return out;
  var W = makeWarn(), MAP = R.status.fromSm, PREC = R.status.sameExtractPrecedence, foot = R.detection.vtSchedMissed.footerPattern;
  for (var n = 1; n < aoa.length; n++) {
    var r = aoa[n]; if (blankRow(r)) continue;
    if (footer(r[0], foot)) { out.skippedFooter++; continue; }
    out.rows++;
    var cn = cnKey(r[idx.caseNumber]); if (!cn) { out.skippedBlank++; continue; }
    var st = MAP[strCell(r[idx.outcome])]; if (!st) { W.add('unknown MissedAndScheduledFitment value: row skipped'); continue; }
    out.lines++;
    var c = out.cases[cn] || (out.cases[cn] = { status: st, apptOn: null, attempt: null, products: [], bundle: null, seller: null, partner: null });
    if (PREC.indexOf(st) < PREC.indexOf(c.status)) c.status = st;
    c.apptOn = maxD(c.apptOn, dateCell(r[idx.apptOn], W.add, 'Fitment Date'));
    c.attempt = c.attempt || strCell(r[idx.attempt]);
    c.products = union(c.products, [strCell(r[idx.productType])]);
    c.bundle = c.bundle || strCell(r[idx.bundle]);
    c.seller = c.seller || normSeller(r[idx.createdBy]) || null;
    c.partner = c.partner || strCell(r[idx.sourcePartner]);
  }
  out.warnings = W.list;
  return out;
}
/* SCHEDULERS DATA (spec 072 D1, U-1 — it replaces the 071 opening book, which took the sale date alone).
   The master VT report's own sheet, read BY POSITION from columns.schedulers with every position checked
   by name, like BI. It is the ONLY source of three facts the daily exports do not carry: the Scheduler (J),
   the GWP (E) and the true sale Date (B). Col G is `Customer Contact` and every unlisted column — the Month,
   the Hrs Ahead and Channel formulas, the three helper columns — is DISCARDED here: nothing but the ten listed
   positions ever leaves this function. `Result` (K) is parsed for the disagreement count and NEVER applied. */
var SCH_NAMES = { saleDate: 'date', agent: 'agent', saleCount: 'sale count', gwp: 'gwp', caseNumber: 'case number',
  campaignRaw: 'campaign/partner', referringAgent: 'referring agent', scheduler: 'scheduler', result: 'result', apptOn: 'date scheduled' };
function parseSchedulers(aoa) {
  var C = R.columns.schedulers, H = (aoa[0] || []).map(norm), idx = {}, missing = [];
  Object.keys(SCH_NAMES).forEach(function (f) { var i = colIndex(C[f]); idx[f] = i; if (H[i] !== SCH_NAMES[f]) missing.push(SCH_NAMES[f] + ' (column ' + C[f] + ')'); });
  var out = { kind: 'schedulers_data', rows: 0, cases: {}, skippedBlank: 0, skippedFooter: 0, missing: missing, duplicates: [], warnings: [] };
  if (missing.length) return out;
  var W = makeWarn(), seen = {}, dup = {}, STV = R.status.values;
  for (var n = 1; n < aoa.length; n++) {
    var r = aoa[n];
    if (blankRow(r)) { out.skippedBlank++; continue; }
    var cn = cnKey(r[idx.caseNumber]), d = dateCell(r[idx.saleDate], W.add, 'Date');
    if (!cn || !d) { out.skippedBlank++; continue; }
    out.rows++;
    if (seen[cn]) { dup[cn] = 1; continue; }
    seen[cn] = 1;
    var g = r[idx.gwp], res = strCell(r[idx.result]), ref = r[idx.referringAgent];
    out.cases[cn] = {
      soldOn: d,
      gwp: g == null || g === '' || !isFinite(+g) ? null : round(+g, 2),
      campaignRaw: strCell(r[idx.campaignRaw]),
      /* F0-19: Referring Agent is the NUMBER 0, not blank, when there is no referrer */
      referring: ref == null || ref === '' || ref === 0 || String(ref).trim() === '0' ? null : normSeller(ref) || null,
      scheduler: normSeller(r[idx.scheduler]) || null,
      agent: normSeller(r[idx.agent]) || null,
      /* F0-20: a blank Date Scheduled reads as serial 0 — serialToISO answers null for it */
      apptOn: dateCell(r[idx.apptOn], W.add, 'Date Scheduled'),
      /* the hand-typed Result, in the engine's own vocabulary where it is one of the four, else as typed */
      result: res ? (STV.indexOf(norm(res)) > -1 ? norm(res) : res) : null,
      saleCount: r[idx.saleCount] == null ? null : +r[idx.saleCount] || 0
    };
    if (out.cases[cn].saleCount != null && out.cases[cn].saleCount !== 1) W.add('a row carries a Sale Count that is not 1: counted as one case (spec A2)');
  }
  out.duplicates = sortedKeys(dup);
  /* A2: one row, one case. A repeated case number makes the whole file unusable, so it is refused and named. */
  if (out.duplicates.length) { out.cases = {}; W.add(out.duplicates.length + ' case number(s) appear more than once in this file: ' + out.duplicates.slice(0, 10).join(', ')); }
  out.warnings = W.list;
  return out;
}
/* Fallback roster from the Agent List workbook (VT + TL sheets): for the Node oracle and the
   file:// station. Production reads the roster of record (/api/roster + vt_roster_at, FR-018). */
function parseRoster(vtAoa, tlAoa, asOf) {
  var H = (vtAoa[0] || []).map(norm), b = byName(H, { code: 'employee code', start: 'start date', tl: 'team leader', name: 'agent name',
    campaign: 'campaign', tenure: 'tenure', role: 'job title', sf: 'sales force', target: 'target' });
  if (b.missing.length) return [];
  var T = ((tlAoa && tlAoa[0]) || []).map(norm), tc = T.indexOf('employee code'), tn = T.indexOf('team leader name'), tl = {};
  (tlAoa || []).slice(1).forEach(function (r) { if (r && tc > -1 && tn > -1 && r[tn]) tl[norm(r[tn])] = normCB(r[tc]); });
  var i = b.idx, out = [];
  vtAoa.slice(1).forEach(function (r) {
    var code = r && normCB(r[i.code]), sub = r && subOf(r[i.campaign]); if (!code || !sub) return;
    var t = typeof r[i.target] === 'number' ? r[i.target] : parseFloat(r[i.target]);
    out.push({ code: code, name: strCell(r[i.name]), sf: strCell(r[i.sf]), tl: strCell(r[i.tl]), tlCode: tl[norm(r[i.tl])] || null, sub: sub,
      campaignRaw: strCell(r[i.campaign]), tenure: strCell(r[i.tenure]), role: strCell(r[i.role]), target: t > 0 ? t : null,
      startDate: typeof r[i.start] === 'number' ? serialToISO(r[i.start]) : null, asOf: asOf || null });
  });
  return out;
}

/* ---------------------------------------------------------------- identity, lead source, team ---- */
function normSeller(name) {
  var s = String(name == null ? '' : name).replace(/\s+/g, ' ');
  (R.identity.stripSuffixes || []).forEach(function (suf) {
    var body = suf.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
    s = s.replace(new RegExp('\\s*' + body + '\\s*$', 'i'), '');
  });
  return norm(s);
}
function tokNear(a, b) {
  if (a === b) return true;
  var min = R.identity.nearMinTokenLength;
  if (a.length < min || b.length < min || Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    var diff = []; for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) { diff.push(i); if (diff.length > 2) return false; }
    if (diff.length <= 1) return true;
    return diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
  }
  var s = a.length < b.length ? a : b, l = a.length < b.length ? b : a, j = 0;
  while (j < s.length && s[j] === l[j]) j++;
  return s.slice(j) === l.slice(j + 1);
}
function nearTokens(a, b) {
  if (a.length !== b.length || a.length < 2) return false;
  var fuzzy = 0; for (var i = 0; i < a.length; i++) { if (a[i] === b[i]) continue; if (!tokNear(a[i], b[i]) || ++fuzzy > 1) return false; }
  return fuzzy === 1;
}
/* exact → alias → one-typo near-spelling → VT-only unique first+last token → unmatched. Every step is
   UNIQUE-OR-NOTHING: two people fitting is nobody (CLAUDE.md 7: flagged, never guessed). */
function resolveSeller(name, roster, aliases, opts) {
  var n = normSeller(name), chain = (opts && opts.chain) || R.identity.chain, tk = n.split(' ').filter(Boolean);
  var people = (roster || []).map(function (r) { return { code: r.code, names: [r.name, r.sf].filter(Boolean).map(normSeller) }; });
  function only(test) { var hit = {}; people.forEach(function (p) { if (p.names.some(test)) hit[p.code] = 1; }); var k = Object.keys(hit); return k.length === 1 ? k[0] : k.length ? false : null; }
  for (var s = 0; n && s < chain.length; s++) {
    var step = chain[s], code = null;
    if (step === 'exact') code = only(function (x) { return x === n; });
    else if (step === 'alias') code = (aliases && aliases[n]) ? normCB(aliases[n]) : null;
    else if (step === 'near') code = only(function (x) { return nearTokens(tk, x.split(' ')); });
    else if (step === 'first_last') code = tk.length < 2 ? null : only(function (x) { var t = x.split(' '); return t.length >= 2 && t[0] === tk[0] && t[t.length - 1] === tk[tk.length - 1]; });
    if (code === false) return { code: null, method: 'unmatched', name: n };
    if (code) return { code: code, method: step, name: n };
  }
  return { code: null, method: 'unmatched', name: n };
}
function leadSourceOf(partner, sellerSub) {
  var L = R.leadSources, p = norm(partner), hit = null;
  Object.keys(L.map).forEach(function (k) { if (norm(k) === p) hit = L.map[k]; });
  if (!hit) return L.unknown;
  if (typeof hit === 'string') return hit;
  return (hit.ifSellerTeam && hit.ifSellerTeam[sellerSub]) || hit['else'];
}
function leadGroupOf(key) { var G = R.leadSources.groups; for (var g in G) if (G[g].indexOf(key) > -1) return g; return null; }
function subOf(campaignRaw) { var m = String(campaignRaw == null ? '' : campaignRaw).match(new RegExp(R.teams.fromCampaignRaw)); return m ? R.teams.keys[m[1]] : null; }

/* ---------------------------------------------------------------- the case book ---- */
/* book = { rev, openedOn, openingBookOn, cases: { "<case number>": row }, events: [ … ] }
   row  = the vt_cases columns (plan DB-2) in camelCase; events = status changes only (FR-013). */
function emptyBook() { return { rev: 0, openedOn: null, openingBookOn: null, cases: {}, events: [] }; }
function better(a, b) { var P = R.status.sameExtractPrecedence; return P.indexOf(a) <= P.indexOf(b) ? a : b; }
function saleDayOf(firstSeen, openedOn) { return firstSeen > openedOn ? { soldOn: firstSeen, soldBasis: R.saleDay.basis } : { soldOn: null, soldBasis: R.saleDay.goLive }; }
function sameRow(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
/* one case row. The last six fields come from Schedulers Data alone (spec 072) and are null until it lands:
   an absence is never a nought, so a case the sheet does not carry shows "—" for its scheduler and its GWP. */
function newRow(cn, ext) {
  return { caseNumber: cn, status: null, statusOn: null, soldOn: null, soldBasis: null, firstSeen: ext, lastSeen: ext,
    apptOn: null, fittedOn: null, smAttempt: null, products: [], bundle: null, chargeEx: null, partnerRaw: null, leadSource: null,
    sellerName: null, sellerCb: null, sellerMatch: null, cancelReason: null,
    schedulerName: null, schedulerCb: null, gwpRpt: null, referringName: null, referringCb: null, campaignRpt: null, resultRpt: null };
}
/* WHICH SALE-DAY BASIS WINS (rule book saleDay.basisPrecedence, plan U-4): schedulers_data > opening_book >
   first_seen. A daily file supplies first_seen, so it may only (re)compute the sale day while the row carries
   no better basis — 'unknown' (the go-live book) is not in the list and is recomputed, exactly as before 072. */
function basisHolds(basis) { return basis != null && R.saleDay.basisPrecedence.indexOf(basis) > -1 && basis !== R.saleDay.basis; }

/* Apply one observed case to its row (FR-011..FR-016). `rel` is where this extract sits against the
   last extract that carried the case: 'new' | 'newer' | 'same' | 'older'. */
function applyObs(prev, o, kind, ext, rel, ctx) {
  var row = prev ? copy(prev) : newRow(o.cn, ext);
  if (row.cancelReason === undefined) row.cancelReason = null;
  var obsDeact = kind === 'bi' && !!o.deactivated;
  var obsStatus = obsDeact ? 'cancelled' : kind === 'bi' ? R.status.fromBi : o.status, wins = rel === 'new' || rel === 'newer' || rel === 'same';
  var st = nextStatus(row, obsStatus, obsDeact, kind, ext, rel), next = st.status;
  var set = function (k, v, overwrite) { if (v != null && (overwrite || row[k] == null)) row[k] = v; };
  if (kind === 'bi') { set('fittedOn', o.fittedOn, wins); set('chargeEx', o.chargeEx, wins); set('bundle', o.bundle, false); }
  else { set('apptOn', o.apptOn, wins); set('smAttempt', o.attempt, wins); set('bundle', o.bundle, wins); }
  row.products = union(row.products, o.products);
  /* the seller and partner come from S&M first (identity.sellerFrom): BI only fills a blank */
  var smFirst = kind === 'sm' && wins;
  if (o.seller && (smFirst || !row.sellerName)) { var who = resolveSeller(o.seller, ctx.roster, ctx.aliases); row.sellerName = who.name; row.sellerCb = who.code; row.sellerMatch = who.method; }
  set('partnerRaw', o.partner, smFirst);
  var team = row.sellerCb && ctx.subOfCode[row.sellerCb];
  row.leadSource = leadSourceOf(row.partnerRaw, team || null);
  row.firstSeen = minD(row.firstSeen, ext); row.lastSeen = maxD(row.lastSeen, ext);
  if (!basisHolds(row.soldBasis)) { var sd = saleDayOf(row.firstSeen, ctx.openedOn); row.soldOn = sd.soldOn; row.soldBasis = sd.soldBasis; }
  var event = null;
  if (next !== row.status || st.reason !== row.cancelReason) {
    var on = next === 'cancelled' && st.reason === 'deactivated' && row.status !== 'cancelled' ? deactDay(o.deactivatedOn, ext, row.statusOn) : ext;
    event = { caseNumber: o.cn, onDate: on, from: row.status, to: next, apptOn: row.apptOn, reason: next === 'cancelled' ? st.reason : null };
    row.status = next; row.statusOn = on; row.cancelReason = next === 'cancelled' ? st.reason : null;
  }
  return { row: row, event: event };
}
/* THE STATUS ONE OBSERVATION LEADS TO (A7 + the derived-cancellation fix R2–R4). Same extract: Cancelled (deactivated) >
   Fitted > Missed > Scheduled. Newer extract: decides between Missed and Scheduled; Fitted is terminal except to an explicit
   deactivation. A case cancelled because it DROPPED out of both files returns to whatever a file of its cancellation day or
   later says (a late file for an earlier day never un-cancels it). A DEACTIVATED case returns only on a newer BI row that is
   Active again — a Scheduled & Missed booking cannot reactivate a contract. An older extract never changes a status. */
function nextStatus(row, obs, obsDeact, kind, ext, rel) {
  var prev = row.status, why = row.cancelReason || null, out = function (s) { return { status: s, reason: s === 'cancelled' ? 'deactivated' : null }; };
  if (rel === 'new') return out(obs);
  if (prev === 'cancelled' && why === 'dropped') return ext >= row.statusOn ? out(obs) : { status: prev, reason: why };
  if (prev === 'cancelled') return kind === 'bi' && !obsDeact && rel === 'newer' ? out(R.status.fromBi) : { status: prev, reason: why };
  if (R.status.terminal.indexOf(prev) > -1) return obsDeact && rel !== 'older' ? out('cancelled') : { status: prev, reason: null };
  if (rel === 'same') return out(better(prev, obs));
  if (rel === 'newer') return out(obs);
  return { status: prev, reason: why };
}
/* the day a deactivation counts from: its own date, never before the case's last status day, never after the extract */
function deactDay(d, ext, prevOn) { return maxD(minD(d || ext, ext), prevOn && prevOn <= ext ? prevOn : null); }

/* BACK-BUILDING THE EARLIER CYCLES (owner decision, spec 072 Q5). The master sheet carries sale dates that reach
   months behind the first daily upload, so loading it populates every business cycle those dates fall in — the
   dashboard can then ask for an earlier cycle, and `prev` is a real comparison instead of "—". How far back: exactly
   as far as the file's own earliest sale date, never further, and never a cycle invented out of nothing. The EARLIEST
   cycle is PARTIAL by construction (the file starts mid-cycle), so it is labelled as such with its first sale date,
   and the flag travels with it so the screen can say so rather than imply a whole month. */
function cyclesOf(byCycle, firstSale) {
  var keys = sortedKeys(byCycle);
  return keys.map(function (k, i) {
    var c = cycleByKey(k), partial = i === 0 && firstSale != null && firstSale > c.from;
    return { key: k, from: c.from, to: c.to, cases: byCycle[k], partial: !!partial, firstSale: firstSale,
      words: partial ? 'Partial: this file\'s earliest sale is ' + firstSale + ', so ' + k + ' holds only the part of the business month (' + c.from + ' to ' + c.to + ') the file reaches back to.'
        : k + ' (' + c.from + ' to ' + c.to + ') is covered in full by this file.' };
  });
}
/* the cycles a BOOK covers, newest first: the business months its sale days fall in (the back-built history). */
function cyclesInBook(book) {
  var byCycle = {}, firstSale = null;
  sortedKeys((book && book.cases) || {}).forEach(function (cn) {
    var d = book.cases[cn].soldOn; if (!d) return;
    byCycle[cycleOf(d).key] = (byCycle[cycleOf(d).key] || 0) + 1; firstSale = minD(firstSale, d);
  });
  return cyclesOf(byCycle, firstSale);
}
/* the previous cycle as dashboard()'s `prev` argument, computed from the back-built book (plan §P: the frozen
   kv:vt-digest-cycle-* is still preferred when one exists — the page passes whichever it has). Pure: no clock,
   and no recursion (the inner call is asked without a prev of its own). */
function prevCycleFor(book, roster, cycleKey, opts) {
  opts = opts || {};
  var cyc = cycleByKey(cycleKey), prevKey = cycleOf(addDays(cyc.from, -1)).key, cov = null;
  cyclesInBook(book).forEach(function (c) { if (c.key === prevKey) cov = c; });
  /* asked at TODAY'S as-at, not the old cycle's end: the book only knows each case's position NOW, which is also
     what the owner's workbook shows for an earlier month. The view still selects on the SALE DATE of that cycle. */
  var d = dashboard(book, roster, { cycleKey: prevKey, view: opts.view || R.views.default, asOf: opts.asOf, isDataOnlyDay: opts.isDataOnlyDay });
  var ch = {}; d.channels.forEach(function (t) { ch[t.k] = { sales: t.sales, fitted: t.fitted }; });
  /* an absence is not a nought (non-negotiable 6): a cycle the book does not reach carries NO counts, so every
     change on the page reads the absent marker with the reason in words, never 0 and never a percentage of nothing. */
  return { cycle: prevKey, present: !!cov, partial: !!(cov && cov.partial), words: cov ? cov.words : 'No sale in the book falls in ' + prevKey + ', so there is no previous cycle to compare with.',
    counts: !cov ? null : { sales: d.counts.sales, fitted: d.counts.fitted, cancelled: d.counts.cancelled, missed: d.counts.missed,
      achievement: d.budget ? d.budget.achievement : null, channels: ch } };
}

/* merge(book, parsed, {extractOn, roster, aliases}) → { book, cases (changed rows), events (new),
   counts, unmatched, warnings }. Pure and deterministic: the input book is never touched. */
function merge(book, parsed, opts) {
  book = book || emptyBook(); opts = opts || {};
  var ext = opts.extractOn, kind = parsed.kind, cases = copy(book.cases || {}), changed = [], events = [];
  var counts = { rows: parsed.rows || 0, vtLines: parsed.vtLines != null ? parsed.vtLines : (parsed.lines || 0), cases: 0, 'new': 0, toFitted: 0, toMissed: 0, toScheduled: 0,
    toCancelled: 0, cancelledDropped: 0, cancelledDeactivated: 0, reappeared: 0, completeDay: null,
    changed: 0, skippedFooter: parsed.skippedFooter || 0, skippedBlank: parsed.skippedBlank || 0, notInBook: 0 };
  var TO = { fitted: 'toFitted', missed: 'toMissed', scheduled: 'toScheduled', cancelled: 'toCancelled' }, cancel = null;
  var tallyEvent = function (e) { counts[TO[e.to]]++; if (e.to === 'cancelled') counts[e.reason === 'dropped' ? 'cancelledDropped' : 'cancelledDeactivated']++; else if (e.from === 'cancelled') counts.reappeared++; };
  var out = { rev: book.rev || 0, openedOn: book.openedOn || null, openingBookOn: book.openingBookOn || null, cases: cases, events: null };
  var unmatched = {}, warnings = (parsed.warnings || []).slice(), sch = null;
  if (!ext) throw new Error('merge needs opts.extractOn');
  if (kind === 'schedulers_data') {
    /* SPEC 072 B2. The sheet supplies three facts nothing else carries — Scheduler (J), GWP (E) and the true sale
       Date (B) — plus the referrer, the campaign it typed and its hand-typed Result. IT NEVER SETS A STATUS: the
       daily exports and the engine's own rules (including derived cancellation) decide that, and a Result that
       disagrees is COUNTED BY DIRECTION and shown, never applied (FR-012, rule book disagree.resultApplied=false). */
    counts.redated = { from_schedulers_data: 0, from_opening_book: 0, from_first_seen: 0, from_unknown: 0, unchanged: 0 };
    counts.schedulersSet = 0; counts.gwpSet = 0; counts.referrersSet = 0;
    var uSch = {}, dir = {}, dtotal = 0, byCycle = {}, firstSale = null;
    sortedKeys(parsed.cases).forEach(function (cn) {
      counts.cases++;
      var p = parsed.cases[cn], prev = cases[cn];
      if (!prev) { counts.notInBook++; return; }                /* named, counted, never invented */
      var row = copy(prev);
      var was = row.soldBasis, same = row.soldOn === p.soldOn && was === 'schedulers_data';
      row.soldOn = p.soldOn; row.soldBasis = 'schedulers_data';
      counts.redated[same ? 'unchanged' : was === 'opening_book' ? 'from_opening_book' : was === 'schedulers_data' ? 'from_schedulers_data'
        : was === R.saleDay.basis ? 'from_first_seen' : 'from_unknown']++;
      if (p.scheduler) {
        var who = resolveSeller(p.scheduler, (opts.roster || []).filter(function (r) { return !r.sub || r.sub === 'scheduling'; }), opts.aliases || {});
        row.schedulerName = who.name; row.schedulerCb = who.code; counts.schedulersSet++;
        if (!who.code) uSch[who.name] = (uSch[who.name] || 0) + 1;
      }
      if (p.gwp != null) { row.gwpRpt = p.gwp; counts.gwpSet++; }
      if (p.referring) {
        var rf = resolveSeller(p.referring, opts.roster, opts.aliases || {});
        row.referringName = rf.name; row.referringCb = rf.code; counts.referrersSet++;
      }
      if (p.campaignRaw) row.campaignRpt = p.campaignRaw;
      row.resultRpt = p.result || null;
      if (p.result && R.status.values.indexOf(p.result) > -1 && row.status && p.result !== row.status) {
        var k = p.result + ' -> ' + row.status; dir[k] = (dir[k] || 0) + 1; dtotal++;
      }
      var ck = cycleOf(row.soldOn).key;
      byCycle[ck] = (byCycle[ck] || 0) + 1;
      firstSale = minD(firstSale, row.soldOn);
      if (!sameRow(row, prev)) { cases[cn] = row; changed.push(row); }
    });
    /* U-5 · the sheet's pre-upload sale dates are what opening_book_on has always meant, so it is set exactly as the
       opening book set it (first value kept). trackFrom, the working-day count, every SPD and every Target
       Achievement therefore read exactly as they would have with the opening book — nothing about the rating moves. */
    out.openingBookOn = out.openingBookOn || ext;
    sch = { disagree: { total: dtotal, byDirection: dir }, cycles: cyclesOf(byCycle, firstSale),
      unmatchedSchedulers: sortedKeys(uSch).map(function (n) { return { name: n, cases: uSch[n] }; }) };
    if (counts.notInBook) warnings.push(counts.notInBook + ' case(s) in this file are not in the Vehicle Tracking book, so they were counted and left alone — the daily exports have not carried them yet.');
    if (dtotal) warnings.push(dtotal + ' case(s) carry a Result that disagrees with the status the daily exports decided: counted and shown, never applied.');
  } else {
    if (!out.openedOn) out.openedOn = ext;
    var ctx = { roster: opts.roster || [], aliases: opts.aliases || {}, openedOn: out.openedOn, subOfCode: {} };
    ctx.roster.forEach(function (r) { ctx.subOfCode[r.code] = r.sub; });
    sortedKeys(parsed.cases).forEach(function (cn) {
      counts.cases++;
      var prev = cases[cn], o = copy(parsed.cases[cn]); o.cn = cn;
      var rel = !prev ? 'new' : ext > prev.lastSeen ? 'newer' : ext === prev.lastSeen ? 'same' : 'older';
      var r = applyObs(prev, o, kind, ext, rel, ctx);
      if (!prev) counts['new']++;
      if (r.event) { events.push(r.event); tallyEvent(r.event); }
      if (!r.row.sellerCb && r.row.sellerName) unmatched[r.row.sellerName] = (unmatched[r.row.sellerName] || 0) + 1;
      if (!prev || !sameRow(r.row, prev)) { cases[cn] = r.row; changed.push(r.row); }
    });
    /* R1 · DERIVED CANCELLATION, after every observation of this file is applied (so the day's union is in last_seen) */
    cancel = dropCheck(kind, ext, opts.receipts);
    counts.completeDay = cancel.complete;
    if (cancel.evaluate) {
      var seen = {}; changed.forEach(function (row) { seen[row.caseNumber] = 1; });
      sortedKeys(cases).forEach(function (cn) {
        var row = cases[cn];
        if (R.status.cancellation.dropped.from.indexOf(row.status) < 0 || !(row.lastSeen < ext)) return;
        var nr = copy(row), e = { caseNumber: cn, onDate: ext, from: row.status, to: 'cancelled', apptOn: row.apptOn, reason: 'dropped' };
        nr.status = 'cancelled'; nr.statusOn = ext; nr.cancelReason = 'dropped';
        cases[cn] = nr; events.push(e); tallyEvent(e);
        if (seen[cn]) changed = changed.map(function (x) { return x.caseNumber === cn ? nr : x; }); else changed.push(nr);
      });
      cancel.cancelled = counts.cancelledDropped;
    }
  }
  counts.changed = changed.length;
  out.events = (book.events || []).concat(events);
  return { book: out, cases: changed, events: events, counts: counts, cancel: cancel,
    unmatched: sortedKeys(unmatched).map(function (n) { return { name: n, cases: unmatched[n] }; }), warnings: warnings,
    disagree: sch ? sch.disagree : null, unmatchedSchedulers: sch ? sch.unmatchedSchedulers : null, cycles: sch ? sch.cycles : null };
}
/* R1 · WHEN A FILE MAY CANCEL (the derived-cancellation fix). An extract day is COMPLETE once a BI Active Fitted AND a
   Scheduled & Missed file of that date are committed; `receipts` are the committed vt_uploads rows the station read AFTER
   the book (so any commit in between moves the revision and this upload's commit is refused and re-merged), and the file
   being merged counts as committed. The day is evaluated by the file that completes it, and only when no LATER extract
   day is complete: a gap day never cancels anything (it never completes), a late file for an older day cancels nothing
   (a newer complete day already decided), and re-sending a file finds nothing open that is absent. No receipts → no proof
   the day is complete → nothing is cancelled. Pure: dates only, no clock. */
var KIND_OF = { bi: 'bi_fitted', sm: 'sched_missed' };
function dropCheck(kind, ext, receipts) {
  var need = R.status.cancellation.dropped.completeDay, have = {}, mine = KIND_OF[kind];
  var res = { complete: false, evaluate: false, newerComplete: null, waitingFor: null, cancelled: 0, note: null };
  if (!mine) return res;
  if (!Array.isArray(receipts)) { res.note = 'The upload receipts were not read, so no sale is marked cancelled from this file.'; return res; }
  receipts.forEach(function (u) { if (u && u.state === 'committed' && need.indexOf(u.kind) > -1 && u.extract_on) (have[u.extract_on] = have[u.extract_on] || {})[u.kind] = 1; });
  (have[ext] = have[ext] || {})[mine] = 1;
  var full = function (d) { return need.every(function (k) { return have[d][k]; }); };
  res.complete = full(ext);
  sortedKeys(have).forEach(function (d) { if (d > ext && full(d)) res.newerComplete = d; });
  var GAP = { bi_fitted: 'BI Active Fitted', sched_missed: 'Scheduled & Missed' };
  if (!res.complete) { res.waitingFor = need.filter(function (k) { return !have[ext][k]; }).map(function (k) { return GAP[k]; }); res.note = 'Waiting for the ' + res.waitingFor.join(' and ') + ' file of ' + ext + ': one file alone never marks a sale cancelled.'; return res; }
  if (res.newerComplete) { res.note = ext + ' is complete, but a newer complete day (' + res.newerComplete + ') already decided which sales dropped out, so nothing is cancelled from this file.'; return res; }
  res.evaluate = true; res.note = ext + ' is complete (both files are in): open sales that are in neither file are now Cancelled (dropped out of both files).';
  return res;
}
/* Convert the vt_book() RPC value (plan DB-3, positional arrays) into a book. The last three columns (Phase C) carry
   what merge and model read back — without partnerRaw a re-read book re-folded every lead source to 'other'. */
/* the last seven are Schedulers Data's own (spec 072 DB-3), APPENDED so every earlier position is unmoved:
   a book read from a database that has not run migration-073 yet simply answers null for them. */
var BOOK_COLS = ['caseNumber', 'status', 'statusOn', 'soldOn', 'soldBasis', 'firstSeen', 'lastSeen', 'apptOn', 'fittedOn', 'products', 'chargeEx', 'leadSource', 'sellerName', 'sellerCb', 'sellerMatch', 'smAttempt', 'bundle', 'partnerRaw', 'cancelReason',
  'schedulerName', 'schedulerCb', 'gwpRpt', 'referringName', 'referringCb', 'campaignRpt', 'resultRpt'];
var EVENT_COLS = ['caseNumber', 'onDate', 'from', 'to', 'apptOn', 'reason'];
function bookFromRpc(v) {
  var b = emptyBook(); if (!v) return b;
  b.rev = v.rev || 0; b.openedOn = v.openedOn || v.opened_on || null; b.openingBookOn = v.openingBookOn || v.opening_book_on || null;
  (v.cases || []).forEach(function (a) { var r = {}; BOOK_COLS.forEach(function (k, i) { r[k] = a[i] == null ? null : a[i]; }); r.caseNumber = cnKey(r.caseNumber); r.products = r.products || []; b.cases[r.caseNumber] = r; });
  b.events = (v.events || []).map(function (a) { var e = {}; EVENT_COLS.forEach(function (k, i) { e[k] = a[i] == null ? null : a[i]; }); e.caseNumber = cnKey(e.caseNumber); return e; });
  return b;
}
/* FR-006: thin pulls are refused (BI) or need the quiet-day tick (S&M); a file with no VT line is refused. */
function guardUpload(kind, cases, lastCount, quietAck) {
  var G = R.guards;
  if (!cases) return { ok: false, reason: 'This file has no Vehicle Tracking lines.' };
  if (lastCount == null || !(lastCount > 0)) return { ok: true, reason: null };
  var share = kind === 'bi' ? G.thinBiShare : G.thinSmShare;
  if (cases >= share * lastCount) return { ok: true, reason: null };
  if (kind !== 'bi' && quietAck) return { ok: true, reason: 'Accepted as a genuine quiet day: ' + cases + ' cases against ' + lastCount + ' on the previous file.', quietDay: true };
  /* 'schedulers' (spec 072 U-6) rides the S&M share: the master sheet is the whole history, so its case count only
     grows and a suddenly short file is a bad export, not a quiet day - but the acknowledgement still exists for the
     uploader who knows better, exactly as for Scheduled & Missed. */
  var WHICH = { bi: 'BI file of this business month', sm: 'Scheduled & Missed file', schedulers: 'Schedulers Data file' };
  return { ok: false, reason: 'Refused as a thin pull: ' + cases + ' cases against ' + lastCount + ' on the previous ' + (WHICH[kind] || 'file of this kind') + '.' };
}

/* ---------------------------------------------------------------- budgets ---- */
function budgetFor(cycleKey) {
  if (R.budgets[cycleKey]) return { cycle: cycleKey, b: R.budgets[cycleKey] };
  var earlier = sortedKeys(R.budgets).filter(function (k) { return k < cycleKey; });
  return earlier.length ? { cycle: earlier[earlier.length - 1], b: R.budgets[earlier[earlier.length - 1]] } : null;
}
function pick(tbl, sub, tenure) { var t = tbl && (tbl[sub] || tbl['*']); if (t == null) return null; if (typeof t === 'number') return t; return t[tenure] != null ? t[tenure] : (t['*'] != null ? t['*'] : null); }
function fitBudget(bud, sub, tenure) { return bud ? pick(bud.b.fitment, sub, tenure) : null; }
function missBudget(bud, sub) { return bud ? pick(bud.b.missed, sub, null) : null; }
function canBudget(bud, sub) { return bud ? pick(bud.b.cancelled, sub || '*', null) : null; }   // shown beside Cancellation %, never scored (R7)
function spdBudget(bud, sub, tenure) { return bud ? pick(bud.b.spd, sub, tenure) : null; }   // the Sales Review SPD budget (the list's Target should equal it — the validator checks, F2)

/* ---------------------------------------------------------------- counts → rates ---- */
function rates(c, wd) {
  var r = copy(c), s = c.sales;
  r.fitRate = s > 0 ? c.fitted / s : null; r.missRate = s > 0 ? c.missed / s : null; r.schedRate = s > 0 ? c.scheduled / s : null;
  r.canRate = s > 0 && c.cancelled != null ? c.cancelled / s : null;   // over ALL the set's sales: a cancelled sale stays in Sales
  r.spd = wd > 0 ? (c.current != null ? c.current : c.sales) / wd : null;
  return r;
}
function inWin(d, w) { return !!d && d >= w.from && d <= w.to; }
/* One window over a set of case facts. mtd=true: the in-play set (Current + Rollover); else the
   cohort sold in the window. Statuses are as at the model's asOf (cohort columns); fitments, missed
   appointments, due-to-fit and value count on their own dates (activity columns). */
function tally(facts, missEv, w, mtd, asOf) {
  var t = { sales: 0, fitted: 0, scheduled: 0, missed: 0, cancelled: R.status.cancelledFrom ? 0 : null, fitDone: 0, missAppt: 0, due: 0, value: 0 };
  if (mtd) { t.current = 0; t.rollover = 0; t.noSaleDay = 0; }
  var act = { from: w.from, to: minD(w.to, asOf) };
  for (var i = 0; i < facts.length; i++) {
    var f = facts[i], inSet = mtd ? f.inPlay : inWin(f.soldOn, w);
    if (inSet) {
      t.sales++; if (t[f.st] != null) t[f.st]++;
      if (mtd) { if (f.current) t.current++; else t.rollover++; if (!f.soldOn) t.noSaleDay++; }
    }
    if (f.installed && inWin(f.fittedOn, act)) { t.fitDone++; t.value += f.charge; }
    if (f.st === 'scheduled' && inWin(f.apptOn, w)) t.due++;
  }
  for (var j = 0; j < missEv.length; j++) if (inWin(missEv[j].apptOn, w)) t.missAppt++;
  t.value = round(t.value * R.vat, 2);
  return t;
}
function hrsAhead(facts, asAt, cycleTo) {
  var h = { total: 0 }, share = {}; R.periods.leadTimeBuckets.forEach(function (b) { h[b.k] = 0; });
  facts.forEach(function (f) { if (f.st !== 'scheduled') return; var k = hrsBucket(f.apptOn, asAt, cycleTo); h.total++; if (k) h[k]++; });
  R.periods.leadTimeBuckets.forEach(function (b) { share[b.k] = h.total ? h[b.k] / h.total : null; });
  h.share = share; return h;
}

/* ---------------------------------------------------------------- model ---- */
function statusAt(row, evs, date) {
  if (!evs || !evs.length) return row.firstSeen <= date ? row.status : null;
  var s = null; for (var i = 0; i < evs.length; i++) if (evs[i].onDate <= date) s = evs[i].to; return s;
}
function rosterFor(roster, key) {
  if (Array.isArray(roster)) return roster;
  var keys = sortedKeys(roster || {}).filter(function (k) { return k <= key; });
  return keys.length ? roster[keys[keys.length - 1]] : [];
}
/* model(book, roster | rosterByCycle, {asOf, cycleKey, isDataOnlyDay, aliases}) → the VT model of one
   business month: every spec §5 column at agent / team leader / sub-campaign / lead source / floor
   for MTD, each week and each day, plus each agent's rating. */
function model(book, roster, opts) {
  opts = opts || {};
  var latest = null; for (var cn0 in book.cases) latest = maxD(latest, book.cases[cn0].lastSeen);
  var asOf = opts.asOf || latest, cyc = opts.cycleKey ? cycleByKey(opts.cycleKey) : cycleOf(asOf);
  asOf = minD(asOf, cyc.to);
  var DO = opts.isDataOnlyDay, ros = rosterFor(roster, cyc.key), byCode = {};
  ros.forEach(function (r) { byCode[r.code] = r; });
  var trackFrom = maxD(cyc.from, book.openingBookOn ? cyc.from : (book.openedOn ? addDays(book.openedOn, 1) : cyc.from));
  var evBy = {}; (book.events || []).forEach(function (e) { (evBy[e.caseNumber] = evBy[e.caseNumber] || []).push(e); });
  /* by day; two changes on ONE day keep their chain (the one whose `to` is the other's `from` goes first) — vt_book returns a
     day's events in to_status order, which would put a fitted unit's same-day deactivation before its fitment */
  for (var k0 in evBy) evBy[k0].sort(function (a, b) { return a.onDate < b.onDate ? -1 : a.onDate > b.onDate ? 1 : a.to === b.from ? -1 : b.to === a.from ? 1 : 0; });
  var before = addDays(cyc.from, -1), OPEN = R.status.open, facts = [], missEv = [], unmatchedNames = {};
  sortedKeys(book.cases).forEach(function (cn) {
    var row = book.cases[cn], evs = evBy[cn], st = statusAt(row, evs, asOf);
    if (!st || (row.soldOn && row.soldOn > asOf)) return;
    var code = row.sellerCb && byCode[row.sellerCb] ? row.sellerCb : (row.sellerName ? resolveSeller(row.sellerName, ros, opts.aliases).code : null);
    var a = code ? byCode[code] : null, current = !!row.soldOn && row.soldOn >= cyc.from;
    var touched = (evs || []).some(function (e) { return e.onDate >= cyc.from && e.onDate <= asOf; });
    var inPlay = current || OPEN.indexOf(statusAt(row, evs, before)) > -1 || touched || inWin(row.fittedOn, { from: cyc.from, to: asOf }) || (!evs && row.lastSeen >= cyc.from);
    var f = { cn: cn, code: code, tl: a ? a.tlCode : null, sub: a ? a.sub : null, lead: leadSourceOf(row.partnerRaw, a ? a.sub : null), st: st,
      soldOn: row.soldOn, current: current, inPlay: inPlay, fittedOn: row.fittedOn, apptOn: row.apptOn, charge: +row.chargeEx || 0,
      /* a fitment done stays done: a unit fitted and later deactivated still counts as an install on its day (R4) */
      installed: st === 'fitted' || (st === 'cancelled' && row.cancelReason === 'deactivated' && !!row.fittedOn && R.status.cancellation.fitDoneKeepsInstall) };
    facts.push(f);
    if (!code && inPlay) unmatchedNames[row.sellerName || '(blank)'] = (unmatchedNames[row.sellerName || '(blank)'] || 0) + 1;
    (evs || []).forEach(function (e) { if (e.to === 'missed' && e.onDate <= asOf) missEv.push({ f: f, apptOn: e.apptOn }); });
  });
  var weeks = weeksOf(cyc), dates = [], hAsAt = hrsAsAt(asOf), bud = budgetFor(cyc.key);
  for (var d = cyc.from; d <= asOf; d = addDays(d, 1)) dates.push(d);
  var wd = function (a, b) { return a && b && a <= b ? workingDaysBetween(a, b, DO) : 0; };
  var mtdWin = { from: cyc.from, to: cyc.to };
  function windows(fs, ev, wdOf) {
    return {
      mtd: rates(tally(fs, ev, mtdWin, true, asOf), wdOf(cyc.from, asOf)),
      weeks: weeks.map(function (w) { var n = wdOf(w.from, minD(w.to, asOf)), r = rates(tally(fs, ev, w, false, asOf), n); r.k = w.k; r.from = w.from; r.to = w.to; r.wd = n; return r; }),
      days: dates.map(function (x) { var r = rates(tally(fs, ev, { from: x, to: x }, false, asOf), 0); r.d = x; return r; })
    };
  }
  var factsOf = function (pred) { return facts.filter(pred); }, evOf = function (pred) { return missEv.filter(function (e) { return pred(e.f); }); };
  var agents = ros.map(function (a) {
    var start = maxD(trackFrom, a.startDate), mine = function (f) { return f.code === a.code; }, fs = factsOf(mine);
    var W = windows(fs, evOf(mine), function (x, y) { return wd(maxD(x, start), y); });
    var fb = fitBudget(bud, a.sub, a.tenure), wdays = wd(start, asOf);
    var finishRow = function (r) { r.target = a.target; r.toTarget = a.target && r.spd != null ? r.spd / a.target : null; return r; };
    W.mtd = finishRow(W.mtd); W.mtd.fitBudget = fb; W.mtd.canBudget = canBudget(bud, a.sub); W.mtd.workingDays = wdays; W.weeks.forEach(finishRow);
    /* the agent split by lead source: MTD (leads), and each week / day (leadWeeks / leadDays, Phase E) so the lead-source
       filter shows agent rows on Weekly and Daily too. The digest carries only the MTD split (plan §P). */
    var leads = {}, leadWeeks = {}, leadDays = {}; fs.forEach(function (f) { leads[f.lead] = 1; });
    sortedKeys(leads).forEach(function (l) { var p = function (f) { return f.code === a.code && f.lead === l; }, lf = factsOf(p), le = evOf(p);
      leads[l] = rates(tally(lf, le, mtdWin, true, asOf), wdays);
      var LW = windows(lf, le, function (x, y) { return wd(maxD(x, start), y); }); leadWeeks[l] = LW.weeks.map(finishRow); leadDays[l] = LW.days; });
    var row = { code: a.code, name: a.name, tl: a.tl, tlCode: a.tlCode, sub: a.sub, tenure: a.tenure, role: a.role, target: a.target, startDate: a.startDate || null,
      workingDays: wdays, trackedDays: wdays, mtd: W.mtd, weeks: W.weeks, days: W.days, leads: leads, leadWeeks: leadWeeks, leadDays: leadDays };
    row.rating = rating(row, { cycleKey: cyc.key, asOf: asOf });
    row.rated = row.rating.rated;
    return row;
  });
  /* aggregates: sums of counts, rates = ratios of sums; % to target = Σ current of targeted agents ÷ Σ (target × their working days) */
  function agg(pred, members, extra) {
    var fs = factsOf(pred), W = windows(fs, evOf(pred), wd);
    var tg = members.filter(function (m) { return m.target > 0; });
    W.mtd.target = tg.length ? round(tg.reduce(function (s, m) { return s + m.target; }, 0), 2) : null;
    var den = tg.reduce(function (s, m) { return s + m.target * m.workingDays; }, 0);
    W.mtd.toTarget = den > 0 ? tg.reduce(function (s, m) { return s + (m.mtd.current || 0); }, 0) / den : null;
    W.weeks.forEach(function (w, i) { var dn = tg.reduce(function (s, m) { return s + m.target * m.weeks[i].wd; }, 0);
      w.target = W.mtd.target; w.toTarget = dn > 0 ? tg.reduce(function (s, m) { return s + m.weeks[i].sales; }, 0) / dn : null; });
    W.hrsAhead = hrsAhead(fs, hAsAt, cyc.to);
    var subs = union(members.map(function (m) { return m.sub; }));
    W.mtd.canBudget = canBudget(bud, extra.sub || (subs.length === 1 ? subs[0] : '*'));
    for (var k in extra) W[k] = extra[k];
    return W;
  }
  var tls = {}; agents.forEach(function (a) { if (a.tlCode) (tls[a.tlCode] = tls[a.tlCode] || []).push(a); });
  var tlAgg = sortedKeys(tls).map(function (t) { var m = tls[t], codes = m.map(function (x) { return x.code; });
    return agg(function (f) { return codes.indexOf(f.code) > -1; }, m, { tlCode: t, tl: m[0].tl, subs: union(m.map(function (x) { return x.sub; })), agents: codes }); });
  var subAgg = {}; Object.keys(R.teams.keys).forEach(function (k) { var s = R.teams.keys[k];
    subAgg[s] = agg(function (f) { return f.sub === s; }, agents.filter(function (a) { return a.sub === s; }), { sub: s }); });
  var leadAgg = {}, lk = {}; facts.forEach(function (f) { lk[f.lead] = 1; });
  sortedKeys(lk).forEach(function (l) { leadAgg[l] = agg(function (f) { return f.lead === l; }, [], { lead: l, label: R.leadSources.labels[l] || l }); });
  Object.keys(R.leadSources.groups).forEach(function (g) { var mem = R.leadSources.groups[g];
    if (mem.length > 1 && !leadAgg[g]) leadAgg[g] = agg(function (f) { return mem.indexOf(f.lead) > -1; }, [], { lead: g, label: R.leadSources.labels[g] || g, members: mem }); });
  var floor = agg(function () { return true; }, agents, {});
  floor.unmatched = { sellers: Object.keys(unmatchedNames).length, cases: Object.keys(unmatchedNames).reduce(function (s, n) { return s + unmatchedNames[n]; }, 0), names: sortedKeys(unmatchedNames) };
  var period = { key: cyc.key, from: cyc.from, to: cyc.to, asOf: asOf, hrsAsAt: hAsAt };
  return {
    period: period, gaps: opts.receipts ? uploadGaps(opts.receipts, { period: period }, DO) : null,
    workingDays: wd(cyc.from, cyc.to), workingDaysElapsed: wd(trackFrom, asOf), trackFrom: trackFrom,
    weeks: weeks, dates: dates, agents: agents,
    notRated: agents.filter(function (a) { return !a.rated; }).map(function (a) { return { code: a.code, name: a.name, tl: a.tl, tlCode: a.tlCode, sub: a.sub, why: a.rating.why }; }),
    tlAgg: tlAgg, subAgg: subAgg, leadAgg: leadAgg, floor: floor,
    budgets: bud ? { cycle: bud.cycle, fitment: bud.b.fitment, missed: bud.b.missed, cancelled: bud.b.cancelled, hrsShare: bud.b.hrsShare, spd: bud.b.spd } : null
  };
}

/* THE UPLOAD GAP (moved here from the page in Phase E, so the digest carries it to Agent Analytics): every working day
   (the engine's calendar) from the first committed upload — or the business month's start — to the figures' date on which
   a daily file was not committed. No file carries a sale date (A5), so a sale first seen on a later upload is counted on
   that later day; this says which days. receipts: vt_uploads rows {kind:'bi_fitted'|'sched_missed', state, extract_on}. */
var GAP_KINDS = { bi_fitted: 'BI Active Fitted', sched_missed: 'Scheduled & Missed' };
function uploadGaps(receipts, M, isDataOnlyDay) {
  var have = { bi_fitted: {}, sched_missed: {} }, first = null, out = [];
  (receipts || []).forEach(function (u) { if (!u || u.state !== 'committed' || !have[u.kind]) return; have[u.kind][u.extract_on] = 1; if (!first || u.extract_on < first) first = u.extract_on; });
  if (!first || !M || !M.period || !M.period.asOf) return out;
  for (var d = maxD(first, M.period.from); d <= M.period.asOf; d = addDays(d, 1)) {
    if (!isWorkingDay(d, isDataOnlyDay)) continue;
    var miss = Object.keys(GAP_KINDS).filter(function (k) { return !have[k][d]; }).map(function (k) { return GAP_KINDS[k]; });
    if (miss.length) out.push({ date: d, missing: miss });
  }
  return out;
}

/* ---------------------------------------------------------------- rating (spec §6) ---- */
function bandOf(score) { if (score == null) return null; var B = R.rating.bands; for (var i = 0; i < B.length; i++) if (score >= B[i].min) return B[i]; return B[B.length - 1]; }
function driverInputs(k, a, bud) {
  var m = a.mtd || {}, G = R.rating, hasT = a.target > 0, days = (a.trackedDays || 0) >= G.minTrackedDays, cases = (m.sales || 0) >= G.minCases;
  var fb = fitBudget(bud, a.sub, a.tenure);
  if (k === 'targetAch') return { value: m.spd, target: hasT ? a.target : null, evidence: hasT && days, why: !hasT ? 'no target' : !days ? 'fewer than ' + G.minTrackedDays + ' tracked working days' : null };
  if (k === 'fitRate') return { value: m.fitRate, target: fb, evidence: cases && fb != null, why: !cases ? 'fewer than ' + G.minCases + ' sales in play' : fb == null ? 'no fitment budget' : null };
  if (k === 'missRate') { var mb = missBudget(bud, a.sub); return { value: m.missRate, target: mb, evidence: cases && mb != null, why: !cases ? 'fewer than ' + G.minCases + ' sales in play' : mb == null ? 'no missed budget' : null }; }
  var t = hasT && fb != null ? round(a.target * (a.workingDays || 0) * fb, 3) : null;
  return { value: m.fitDone, target: t, evidence: t != null && t > 0 && days, why: !hasT ? 'no target' : fb == null ? 'no fitment budget' : !days ? 'fewer than ' + G.minTrackedDays + ' tracked working days' : null };
}
/* the unscored figures the card shows under its driver rows (vt-1.2): missed and cancelled beside their budgets and the
   fitments done. Carried, never scored — a missed or cancelled sale already lowers Fitment Rate, once. */
function ratingInfo(a, bud) {
  var m = a.mtd || {}, o = {};
  R.rating.info.forEach(function (k) { o[k] = k === 'missBudget' ? missBudget(bud, a.sub) : k === 'canBudget' ? canBudget(bud, a.sub) : (m[k] == null ? null : m[k]); });
  return o;
}
/* rating(agentRow, {cycleKey, asOf, drivers?}) — points start at half of target, unmeasured drivers renormalise,
   effective weights published (FR-042), no penalties, no ranking. ctx.drivers replaces the rule book's driver list
   (tests only: it keeps the lower-is-better path, which no live driver uses since vt-1.2, exercised). */
function rating(a, ctx) {
  var G = R.rating, F = G.floor, cyc = cycleByKey(ctx.cycleKey), bud = budgetFor(ctx.cycleKey), DRV = ctx.drivers || G.drivers;
  var base = { rated: false, why: null, score: null, adj: null, band: null, nextBand: null, parts: [], weightScored: 0, unmeasured: [], weakest: null, onTarget: null, measuredCount: 0,
    window: { from: cyc.from, to: ctx.asOf || null }, budgetCycle: bud ? bud.cycle : null, info: ratingInfo(a, bud) };
  if (R.teams.notRated.indexOf(a.sub) > -1) { base.why = 'scheduling'; return base; }
  if (((a.mtd || {}).sales || 0) < G.minInPlayToRate) { base.why = 'nodata'; return base; }
  var parts = DRV.map(function (d) {
    var x = driverInputs(d.k, a, bud), v = x.value, t = x.target, att = null;
    if (v != null && t != null) att = d.dir === 'lower' ? (v === 0 ? 1 : clamp01(t / v)) : (t > 0 ? clamp01(v / t) : null);
    var measured = !!x.evidence && att != null;
    return { k: d.k, label: d.label, w: d.w, dir: d.dir, value: v, target: t, measured: measured, shown: true, att: att,
      points: measured ? round(d.w * clamp01((att - F) / (1 - F)), 1) : null,
      onTarget: v == null || t == null ? null : d.dir === 'lower' ? v <= t : v >= t, note: d.note, why: measured ? null : (x.why || 'no value yet') };
  });
  var ws = parts.reduce(function (s, p) { return s + (p.measured ? p.w : 0); }, 0), raw = parts.reduce(function (s, p) { return s + (p.measured ? p.points : 0); }, 0);
  parts.forEach(function (p) { p.weff = p.measured ? round(p.w / ws * 100, 1) : null; p.pointsEff = p.measured ? round(p.points * 100 / ws, 1) : null;
    p.available = p.measured ? round(p.weff - p.pointsEff, 1) : null; });
  base.parts = parts; base.weightScored = ws; base.unmeasured = parts.filter(function (p) { return !p.measured; }).map(function (p) { return p.k; });
  if (!ws) { base.why = 'nodata'; return base; }
  var score = round(Math.min(100, raw / ws * 100), 1), band = bandOf(score), B = G.bands, i = B.indexOf(band);
  base.rated = true; base.score = score; base.adj = score; base.band = band.label;
  base.nextBand = i > 0 ? { label: B[i - 1].label, min: B[i - 1].min, gap: round(B[i - 1].min - score, 1) } : null;
  var best = null; parts.forEach(function (p) { if (p.measured && (!best || p.available > best.available)) best = p; });
  base.weakest = best ? best.k : null;
  base.onTarget = parts.filter(function (p) { return p.measured && p.onTarget; }).length; base.measuredCount = parts.filter(function (p) { return p.measured; }).length;   // the card's "n of your m drivers" (Phase E)
  return base;
}

/* ---------------------------------------------------------------- digest (plan §P) ---- */
function driversOnce() { return R.rating.drivers.map(function (d) { return { k: d.k, label: d.label, w: d.w, dir: d.dir, note: d.note }; }); }
/* THE PUBLISHED SHAPE (size: a full business month of ~48 agents is ~530 KB as objects, ~85 % of it day rows). So every
   days[] in the digest is COLUMNAR — one array per day in the order of the top-level dayCols — and every fraction is kept
   to six decimals (a rate is printed to 0.1 %). The agent row drops the weekly / daily lead-source splits (PULSE's pages
   only) and the per-agent driver labels and notes, which travel once in drivers. Nothing is recomputed: values are carried. */
var DAY_COLS = ['d', 'sales', 'fitted', 'scheduled', 'missed', 'cancelled', 'fitDone', 'missAppt', 'due', 'value', 'fitRate', 'missRate', 'schedRate', 'canRate'];
function six(v) { return typeof v === 'number' && v % 1 !== 0 ? Math.round(v * 1e6) / 1e6 : v; }
function dayCells(x) { return DAY_COLS.map(function (k) { return x[k] == null ? null : six(x[k]); }); }
function compact(o) {
  if (Array.isArray(o)) return o.map(compact);
  if (!o || typeof o !== 'object') return six(o);
  var r = {}; for (var k in o) r[k] = k === 'days' && Array.isArray(o[k]) ? o[k].map(dayCells) : compact(o[k]);
  return r;
}
function digestRow(a) {
  var r = {}; for (var k in a) if (k !== 'leadWeeks' && k !== 'leadDays') r[k] = a[k];
  r.rating = copy(a.rating); r.rating.parts = (a.rating.parts || []).map(function (p) { var q = copy(p); delete q.label; delete q.note; return q; });
  return r;
}
/* digest(model, {updatedAt}) — `empty` is DERIVED (no in-play sale anywhere on the floor), never the caller's say-so */
function digest(M, opts) {
  opts = opts || {};
  var fl = M.floor && M.floor.mtd, empty = !(fl && fl.sales > 0) && !M.agents.some(function (a) { return a.mtd && a.mtd.sales > 0; });
  return { scorecard: 'vt', version: R.version, rulesVersion: R.version, period: M.period, empty: empty, updatedAt: opts.updatedAt || null,
    workingDays: M.workingDays, workingDaysElapsed: M.workingDaysElapsed, trackFrom: M.trackFrom, weeks: M.weeks, dates: M.dates, drivers: driversOnce(),
    agents: compact(M.agents.map(digestRow)), notRated: M.notRated, tlAgg: compact(M.tlAgg), subAgg: compact(M.subAgg), leadAgg: compact(M.leadAgg),
    floor: compact(M.floor), budgets: M.budgets, gaps: M.gaps || null, dayCols: DAY_COLS, minima: { cases: R.rating.minCases, trackedDays: R.rating.minTrackedDays, floor: R.rating.floor } };
}
function emptyCyclePayload(cycleKey, opts) {
  var c = cycleByKey(cycleKey), bud = budgetFor(cycleKey);
  return { scorecard: 'vt', version: R.version, rulesVersion: R.version, period: { key: c.key, from: c.from, to: c.to, asOf: null, hrsAsAt: null }, empty: true,
    updatedAt: (opts && opts.updatedAt) || null, workingDays: workingDaysBetween(c.from, c.to), workingDaysElapsed: null, weeks: weeksOf(c), dates: [],
    drivers: driversOnce(), agents: [], notRated: [], tlAgg: [], subAgg: {}, leadAgg: {},
    floor: { mtd: null, weeks: [], days: [], hrsAhead: null, unmatched: null }, trackFrom: null, gaps: null, dayCols: DAY_COLS, minima: { cases: R.rating.minCases, trackedDays: R.rating.minTrackedDays, floor: R.rating.floor },
    budgets: bud ? { cycle: bud.cycle, fitment: bud.b.fitment, missed: bud.b.missed, cancelled: bud.b.cancelled, hrsShare: bud.b.hrsShare, spd: bud.b.spd } : null };
}

/* ---------------------------------------------------------------- the dashboard (072) ----
 * VTEngine.dashboard(book, roster, {cycleKey, view, asOf, prev, isDataOnlyDay, filters}) — the whole
 * VT Report page as one object. PURE: no DOM, no fetch, no clock (asOf comes in), the book is never
 * mutated, and the same inputs always give the same answer. THE ENGINE DECIDES, THE PAGE PAINTS: the
 * page holds no arithmetic and no threshold, and every target here is a rule-book value that carries
 * its Sales Review cell so the panel can name it on screen.
 *
 * It sits BESIDE model() rather than inside it: four views over twenty panels would bloat the one
 * function three live pages and the digest depend on (plan, Complexity Tracking).
 *
 * The four views (rule book views.list) and the asymmetry that makes them balance: Sales and Fitments
 * add the pre-cycle Fitted term, while Scheduled / Missed / Cancelled are IN-CYCLE ONLY. That is what
 * the owner's own Sales Review cells do (spec F0-9) and it is why K17 reconciles; "fixing" it would
 * break the reconciliation. Lead time and upcoming fitments cover ALL bookings whatever the view.
 */
function cycleBudgetFor(cycleKey) {
  var CB = R.cycleBudget, keys = sortedKeys(CB).filter(function (k) { return CB[k] && typeof CB[k] === 'object'; });
  if (CB[cycleKey]) return { cycle: cycleKey, b: CB[cycleKey], fallback: false, words: 'Targets are the Sales Review\'s own, for ' + cycleKey + '.' };
  var earlier = keys.filter(function (k) { return k < cycleKey; });
  if (!earlier.length) return null;
  var k = earlier[earlier.length - 1];
  return { cycle: k, b: CB[k], fallback: true, words: 'No targets are on file for ' + cycleKey + ', so the ' + k + ' targets are shown and named.' };
}
/* the campaign → channel map, exact match on the raw Campaign/Partner, unmapped → Other (FR-026).
   With no Schedulers Data row the campaign is unknown, so the engine's own lead-source GROUP stands
   in — the daily exports keep every channel panel working (spec edge case). */
var _CMAP = null;
function campaignChannelMap() {
  if (_CMAP) return _CMAP;
  _CMAP = {}; var M = R.channels.campaignMap;
  Object.keys(M).forEach(function (k) { _CMAP[norm(k)] = M[k]; });
  return _CMAP;
}
function channelOf(campaign, leadSource) {
  var c = strCell(campaign), m = campaignChannelMap();
  if (c) return m[norm(c)] || R.channels.unmapped;
  var g = leadGroupOf(leadSource);
  return g && R.channels.keys.indexOf(g) > -1 ? g : R.channels.unmapped;
}
function viewDef(key) {
  var L = R.views.list, k = key || R.views.default;
  for (var i = 0; i < L.length; i++) if (L[i].k === k) return L[i];
  return L[0];
}
function ratio(a, b) { return b > 0 ? a / b : null; }
function fmtN(n) { return n == null ? R.reports.absent : String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function fmtP(x) { return x == null ? R.reports.absent : (x * 100).toFixed(1) + '%'; }
function fmtR(n) { return n == null ? R.reports.absent : fmtN(n); }
function fill(tpl, vals) { return String(tpl).replace(/\{(\w+)\}/g, function (m, k) { return vals[k] == null ? R.reports.absent : String(vals[k]); }); }

/* one pass over the book → the dashboard's facts. Customer data is never in the book and is never
   read here; a scheduler, an agent or a referrer travels as the name the source typed (PII stays out
   of every output but the staff name the report already carries). */
function dashFacts(book, cyc, asOf) {
  var evBy = {}; (book.events || []).forEach(function (e) { (evBy[e.caseNumber] = evBy[e.caseNumber] || []).push(e); });
  for (var k0 in evBy) evBy[k0].sort(function (a, b) { return a.onDate < b.onDate ? -1 : a.onDate > b.onDate ? 1 : a.to === b.from ? -1 : b.to === a.from ? 1 : 0; });
  var out = [], noSaleDay = 0, anyGwp = false, anyScheduler = false;
  sortedKeys(book.cases).forEach(function (cn) {
    var row = book.cases[cn], st = statusAt(row, evBy[cn], asOf);
    if (!st) return;
    if (row.gwpRpt != null) anyGwp = true;
    if (strCell(row.schedulerName)) anyScheduler = true;
    if (!row.soldOn) { noSaleDay++; return; }                 /* in play, never counted as a sale on any day */
    if (row.soldOn > asOf) return;
    var campaign = strCell(row.campaignRpt);
    out.push({
      cn: cn, st: st, soldOn: row.soldOn, apptOn: row.apptOn || null,
      current: row.soldOn >= cyc.from && row.soldOn <= cyc.to, pre: row.soldOn < cyc.from,
      campaign: campaign, channel: channelOf(campaign, row.leadSource),
      gwp: row.gwpRpt == null ? null : +row.gwpRpt,
      scheduler: strCell(row.schedulerName), schedulerCb: row.schedulerCb || null,
      agent: strCell(row.sellerName), agentCb: row.sellerCb || null,
      referrer: strCell(row.referringName), referrerCb: row.referringCb || null,
      resultRpt: row.resultRpt || null
    });
  });
  return { facts: out, noSaleDay: noSaleDay, gwpLoaded: anyGwp, schedulersLoaded: anyScheduler };
}
/* the five lead-time buckets over one scheduled set, frozen at `asAt`, split on the cycle end (D5/D6).
   `past` is carried separately: the workbook's K18 adds the FIVE, and so do we. */
function bucketRows(scheduled, asAt, cycleTo, budgetBase) {
  var B = R.periods.leadTimeBuckets, share = R.dashboardHrsShare, tally = {}, past = 0, unreach = {};
  B.forEach(function (b) { tally[b.k] = 0; });
  scheduled.forEach(function (f) { var k = hrsBucket(f.apptOn, asAt, cycleTo); if (k) tally[k]++; });
  past = tally.past;
  var ahead = B.filter(function (b) { return b.k !== 'past'; }), total = ahead.reduce(function (s, b) { return s + tally[b.k]; }, 0);
  /* a bucket whose rule cannot be satisfied between the as-at and the cycle end is structurally empty,
     not missing data: '72+ in cycle' needs minDays of room before the cycle end (F0-15, Q4). */
  ahead.forEach(function (b) { unreach[b.k] = b.cutoff === 'cycle.to' && b.cutoffOp === '<=' && b.minDays != null && cycleTo != null && dayDiff(cycleTo, asAt) < b.minDays; });
  return {
    rows: ahead.map(function (b) {
      var target = share[b.k] == null || budgetBase == null ? null : share[b.k] * budgetBase;
      return { k: b.k, label: b.label, count: tally[b.k], share: ratio(tally[b.k], total), target: target,
        attainment: target > 0 ? tally[b.k] / target : null, structuralZero: !!(unreach[b.k] && tally[b.k] === 0),
        words: unreach[b.k] && tally[b.k] === 0 ? R.dashboardHrsShare.structuralZero : null };
    }),
    total: total, past: past
  };
}
function dashboard(book, roster, opts) {
  opts = opts || {}; book = book || emptyBook();
  var V = R.views, CH = R.channels, vd = viewDef(opts.view);
  var cyc = opts.cycleKey ? cycleByKey(opts.cycleKey) : cycleOf(opts.asOf);
  var seen = null; for (var c0 in book.cases) seen = maxD(seen, book.cases[c0].lastSeen, book.cases[c0].soldOn);
  var asOf = opts.asOf || seen, DO = opts.isDataOnlyDay;
  var F = dashFacts(book, cyc, asOf), facts = F.facts;
  var maxSold = null, minSold = null;
  facts.forEach(function (f) { maxSold = maxD(maxSold, f.soldOn); minSold = minD(minSold, f.soldOn); });
  var dataThrough = minD(cyc.to, maxSold), hAsAt = dataThrough ? hrsAsAt(dataThrough) : null;

  /* ---- the view: one predicate for the SALES set, one for the open outcomes (F0-9) ---- */
  var only = vd.preCycle && vd.preCycle.include ? vd.preCycle.onlyStatus : undefined;
  var inSales = vd.k === 'rollovers' ? function (f) { return f.pre; }
    : !vd.preCycle.include ? function (f) { return f.current; }
      : only ? function (f) { return f.current || (f.pre && f.st === only); }
        : function () { return true; };
  var inOpen = vd.openOutcomesInCycleOnly ? function (f) { return f.current; } : inSales;
  var sales = facts.filter(inSales), open = facts.filter(inOpen);
  var countOf = function (list, st) { var n = 0; for (var i = 0; i < list.length; i++) if (list[i].st === st) n++; return n; };
  var sumGwp = function (list, test) { var s = 0, any = false; list.forEach(function (f) { if (test(f) && f.gwp != null) { s += f.gwp; any = true; } }); return any || F.gwpLoaded ? s : null; };
  function tallySet(sl, op) {
    var t = { sales: sl.length, fitted: countOf(sl, 'fitted'), scheduled: countOf(op, 'scheduled'), missed: countOf(op, 'missed'), cancelled: countOf(op, 'cancelled') };
    t.gwpFitted = F.gwpLoaded ? sumGwp(sl, function (f) { return f.st === 'fitted'; }) : null;
    t.gwpTotal = F.gwpLoaded ? sumGwp(sl, function () { return true; }) : null;
    t.fitRate = ratio(t.fitted, t.sales); t.missRate = ratio(t.missed, t.sales);
    t.schedRate = ratio(t.scheduled, t.sales); t.canRate = ratio(t.cancelled, t.sales);
    return t;
  }
  var counts = tallySet(sales, open);
  var rates = { fitRate: counts.fitRate, missRate: counts.missRate, schedRate: counts.schedRate, canRate: counts.canRate };

  /* ---- dialing days and the straight-line forecast (FR-036..FR-040) ---- */
  var wdOf = function (a, b) { return a && b && a <= b ? workingDaysBetween(a, b, DO) : 0; };
  var ddTotal = wdOf(cyc.from, cyc.to), ddElapsed = wdOf(cyc.from, dataThrough);
  var dialing = { total: ddTotal, elapsed: ddElapsed, left: ddTotal - ddElapsed, pct: ratio(ddElapsed, ddTotal),
    words: 'Dialing day ' + ddElapsed + ' of ' + ddTotal + ', the working days of the cycle on the rule book\'s calendar.' };
  var bud = cycleBudgetFor(cyc.key), cb = bud ? bud.b : null;
  var pace = function (actual) { return ddElapsed > 0 ? actual / ddElapsed * ddTotal : null; };
  var forecast = { sales: pace(counts.sales), fitments: pace(counts.fitted), method: R.forecast.method,
    label: R.forecast.label, basis: R.forecast.formula, elapsed: ddElapsed, total: ddTotal,
    words: 'A ' + R.forecast.label + ': ' + R.forecast.formula + ', over the cycle\'s dialing days.' };
  var budget = bud ? {
    cycle: bud.cycle, fallback: bud.fallback, words: bud.words, cells: cb.cells,
    sales: cb.sales, fitments: cb.fitments, fitmentRate: cb.fitmentRate['*'],
    cancelledPct: cb.cancelledPct['*'], missedPct: cb.missedPct['*'], scheduledPct: cb.scheduledPct['*'],
    headcount: cb.headcount, dialingDays: cb.dialingDays,
    achievement: ratio(counts.sales, cb.sales.total), fitAchievement: ratio(counts.fitted, cb.fitments.total),
    forecastVsSales: ratio(forecast.sales, cb.sales.total), forecastVsFitments: ratio(forecast.fitments, cb.fitments.total)
  } : null;
  if (budget) { forecast.salesVsBudget = budget.forecastVsSales; forecast.fitmentsVsBudget = budget.forecastVsFitments; }

  /* ---- the five lead-time buckets: the view's scheduled set, and every booking there is (FR-029) ---- */
  var base = cb ? cb.scheduledPct['*'] * cb.sales[CH.keys[0]] : null;   /* SR B94 = 0.75 x B88, B88 = 0.1 x B52 */
  var bkView = bucketRows(open.filter(function (f) { return f.st === 'scheduled'; }), hAsAt, cyc.to, base);
  var bkAll = bucketRows(facts.filter(function (f) { return f.st === 'scheduled'; }), hAsAt, cyc.to, base);
  var bucketWords = 'Lead time is frozen at ' + hAsAt + ' (the extract plus one day), never a clock, and the two 72+ buckets split on the cycle end ' + cyc.to + '.';

  /* ---- channels (the donut shape) and campaigns (the ranked-bar shape) ---- */
  var byChannel = CH.keys.map(function (k) {
    var sl = sales.filter(function (f) { return f.channel === k; }), op = open.filter(function (f) { return f.channel === k; });
    var t = tallySet(sl, op);
    t.k = k; t.label = CH.labels[k]; t.srLabel = CH.salesReviewLabels[k];
    t.share = ratio(t.sales, counts.sales);
    t.salesBudget = cb && cb.sales[k] != null ? cb.sales[k] : null;
    t.fitmentBudget = cb && cb.fitments[k] != null ? cb.fitments[k] : null;
    t.fitmentRateBudget = cb ? cb.fitmentRate['*'] : null;
    t.achievement = ratio(t.sales, t.salesBudget);
    t.forecastSales = pace(t.sales); t.forecastFitments = pace(t.fitted);
    t.targetWords = t.salesBudget == null ? 'This channel has an actual and no target: the Sales Review carries no budget row for it.' : bud.words;
    return t;
  });
  var campNames = {}; sales.forEach(function (f) { if (f.campaign) campNames[f.campaign] = 1; });
  var campaigns = sortedKeys(campNames).map(function (name) {
    var sl = sales.filter(function (f) { return f.campaign === name; }), op = open.filter(function (f) { return f.campaign === name; });
    var t = tallySet(sl, op); t.name = name; t.channel = channelOf(name, null);
    t.share = ratio(t.sales, counts.sales); t.rollup = false;
    t.mapped = !!campaignChannelMap()[norm(name)];
    return t;
  }).sort(function (a, b) { return b.sales - a.sales || (a.name < b.name ? -1 : 1); });
  var unmapped = campaigns.filter(function (c) { return !c.mapped; }).map(function (c) { return c.name; });
  var rollups = sortedKeys(CH.rollups).map(function (rk) {
    var r = CH.rollups[rk], mem = r.members;
    var sl = sales.filter(function (f) { return mem.indexOf(f.channel) > -1; }), op = open.filter(function (f) { return mem.indexOf(f.channel) > -1; });
    var t = tallySet(sl, op); t.k = rk; t.label = r.label; t.members = mem.slice(); t.rollup = true;
    t.salesBudget = cb ? mem.reduce(function (s, m) { return s + (cb.sales[m] || 0); }, 0) : null;
    t.fitmentBudget = cb ? mem.reduce(function (s, m) { return s + (cb.fitments[m] || 0); }, 0) : null;
    t.words = r.label + ' is a named roll-up of ' + mem.map(function (m) { return CH.labels[m]; }).join(' + ') + ' and is never counted twice in a total.';
    return t;
  });

  /* ---- Performance Trend: the workbook's own week window, the engine's own cycle weeks (FR-021..024) ---- */
  var minSoldV = null, maxSoldV = null;
  sales.forEach(function (f) { minSoldV = minD(minSoldV, f.soldOn); maxSoldV = maxD(maxSoldV, f.soldOn); });
  var weeks = [];
  if (minSoldV) {
    for (var w = mondayOf(minSoldV); w < cyc.from; w = addDays(w, 7)) weeks.push({ from: w, to: minD(addDays(w, 6), addDays(cyc.from, -1)), preCycle: true, postCycle: false });
    weeksOf(cyc).forEach(function (x) { weeks.push({ from: x.from, to: x.to, preCycle: false, postCycle: false }); });
    if (maxSoldV > cyc.to) { var p = addDays(cyc.to, 1);
      while (p <= maxSoldV) { var pe = minD(addDays(mondayOf(p), 6), maxSoldV); weeks.push({ from: p, to: pe, preCycle: false, postCycle: true }); p = addDays(pe, 1); } }
  }
  weeks = weeks.map(function (x) {
    var sl = sales.filter(function (f) { return f.soldOn >= x.from && f.soldOn <= x.to; });
    var op = open.filter(function (f) { return f.soldOn >= x.from && f.soldOn <= x.to; });
    var t = tallySet(sl, op), dd = x.preCycle || x.postCycle ? null : wdOf(maxD(x.from, cyc.from), minD(x.to, cyc.to));
    t.k = x.from; t.from = x.from; t.to = x.to; t.label = short(x.from) + ' – ' + short(x.to);
    t.preCycle = x.preCycle; t.postCycle = x.postCycle; t.dialingDays = dd;
    t.fittedOnly = !!(x.preCycle && vd.preCycle && vd.preCycle.onlyStatus === 'fitted');
    t.target = dd != null && cb && ddTotal > 0 ? cb.sales.total / ddTotal * dd : null;
    t.words = t.fittedOnly ? V.rollover.preCycleWeeksAreFittedOnly : null;
    return t;
  });
  var weekWords = 'Weeks are the engine\'s cycle weeks, ' + R.periods.weekWindow + '. Each week\'s target is the cycle sales budget over the cycle\'s dialing days, times that week\'s dialing days.';

  /* ---- the previous cycle, the KPI cards and the Detailed Breakdown ---- */
  var pv = opts.prev && (opts.prev.counts || opts.prev), prevOk = !!(pv && pv.sales != null);
  var prevCycle = { present: prevOk, cycle: (opts.prev && opts.prev.cycle) || null,
    words: prevOk ? 'Change is against ' + ((opts.prev && opts.prev.cycle) || 'the previous cycle') + '.'
      : 'There is no previous cycle on file, so every change reads ' + R.reports.absent + ' — never 0 and never a percentage of nothing.' };
  var deltaOf = function (now, was) { return prevOk && was != null && now != null ? { abs: now - was, pct: ratio(now - was, was) } : null; };
  var kpis = [
    { k: 'sales', label: 'Total Sales', value: counts.sales, delta: deltaOf(counts.sales, prevOk ? pv.sales : null),
      words: fmtN(counts.sales) + ' sales in view.', cell: 'Sales Review C51 / Exco Summary B7' },
    { k: 'fitted', label: 'Total Fitments', value: counts.fitted, delta: deltaOf(counts.fitted, prevOk ? pv.fitted : null),
      pct: rates.fitRate, budget: budget ? budget.fitmentRate : null, scored: false,
      words: fmtN(counts.fitted) + ' fitted, ' + fmtP(rates.fitRate) + ' of sales, against the dashboard\'s flat ' + fmtP(budget ? budget.fitmentRate : null) + ' target.',
      cell: 'Sales Review C57 / B63' },
    { k: 'cancelled', label: 'Cancellations', value: counts.cancelled, delta: deltaOf(counts.cancelled, prevOk ? pv.cancelled : null),
      pct: rates.canRate, budget: budget ? budget.cancelledPct : null, scored: false,
      words: fmtN(counts.cancelled) + ' cancelled, ' + fmtP(rates.canRate) + ' of sales, beside the ' + fmtP(budget ? budget.cancelledPct : null) + ' budget. Shown, never scored.',
      cell: 'Sales Review C75 / C81' },
    { k: 'missed', label: 'Missed', value: counts.missed, delta: deltaOf(counts.missed, prevOk ? pv.missed : null),
      pct: rates.missRate, budget: budget ? budget.missedPct : null, scored: false,
      words: fmtN(counts.missed) + ' missed, ' + fmtP(rates.missRate) + ' of sales, beside the ' + fmtP(budget ? budget.missedPct : null) + ' budget. Shown, never scored.',
      cell: 'Sales Review C69' },
    { k: 'targetAchieved', label: 'Target Achieved', value: budget ? budget.achievement : null,
      delta: deltaOf(budget ? budget.achievement : null, prevOk ? pv.achievement : null),
      words: budget ? fmtP(budget.achievement) + ' of the ' + fmtN(budget.sales.total) + ' cycle sales budget' : 'No cycle sales budget is on file.',
      cell: budget ? budget.cells.sales : null }
  ];
  var breakdown = byChannel.map(function (t) {
    return { k: t.k, label: t.label, srLabel: t.srLabel, sales: t.sales, fitted: t.fitted, cancelled: t.cancelled, missed: t.missed,
      scheduled: t.scheduled, fitRate: t.fitRate, canRate: t.canRate, missRate: t.missRate, salesBudget: t.salesBudget,
      fitmentBudget: t.fitmentBudget, achievement: t.achievement, forecastSales: t.forecastSales, forecastFitments: t.forecastFitments,
      delta: deltaOf(t.sales, prevOk && pv.channels ? (pv.channels[t.k] || {}).sales : null) };
  });
  var breakdownTotals = { k: 'total', label: 'Total', sales: counts.sales, fitted: counts.fitted, cancelled: counts.cancelled,
    missed: counts.missed, scheduled: counts.scheduled, fitRate: rates.fitRate, canRate: rates.canRate, missRate: rates.missRate,
    salesBudget: budget ? budget.sales.total : null, fitmentBudget: budget ? budget.fitments.total : null,
    achievement: budget ? budget.achievement : null, forecastSales: forecast.sales, forecastFitments: forecast.fitments,
    delta: deltaOf(counts.sales, prevOk ? pv.sales : null), words: R.reports.totals };

  /* ---- GWP: the Schedulers Data figure, named, and never the engine's BI value (A7, FR-016) ---- */
  var gwp = {
    loaded: F.gwpLoaded,
    fitted: F.gwpLoaded ? counts.gwpFitted : null,
    total: F.gwpLoaded ? counts.gwpTotal : null,
    lost: F.gwpLoaded ? sumGwp(sales, function (f) { return f.st === 'cancelled' || f.st === 'missed'; }) : null,
    open: F.gwpLoaded ? sumGwp(open, function (f) { return R.status.open.indexOf(f.st) > -1 || f.st === 'cancelled'; }) : null,
    source: R.reports.gwp.source, notSource: R.reports.gwp.notSource,
    words: F.gwpLoaded ? 'GWP is ' + R.reports.gwp.source + '. It is not the engine\'s fitted value, which is the BI charge: see ' + R.reports.gwp.notSource
      : 'GWP needs the Schedulers Data upload; nothing is painted here and no figure is guessed.'
  };

  /* ---- the Rollover Follow-up panel: always the pre-cycle position, whatever the view (FR-049) ---- */
  var preAll = facts.filter(function (f) { return f.pre; });
  var rollRow = function (list) {
    var t = tallySet(list, list);
    t.open = t.scheduled + t.cancelled + t.missed;
    t.fittedPct = ratio(t.fitted, t.sales); t.openPct = ratio(t.open, t.sales);
    t.gwpOpen = F.gwpLoaded ? sumGwp(list, function (f) { return f.st === 'scheduled' || f.st === 'cancelled' || f.st === 'missed'; }) : null;
    return t;
  };
  var rollover = {
    rows: CH.keys.map(function (k) { var r = rollRow(preAll.filter(function (f) { return f.channel === k; })); r.k = k; r.label = CH.labels[k]; return r; }),
    totals: rollRow(preAll),
    words: 'Rollovers are sales dated before ' + cyc.from + '. A fitted rollover counts towards this cycle; ' +
      R.views.rollover.openToAction.join(', ') + ' are open to action and must be scheduled or rebooked. This panel is always the pre-cycle position, whatever the view.'
  };
  rollover.totals.k = 'total'; rollover.totals.label = 'Total';

  /* ---- Upcoming Scheduled Fitments: all bookings, regardless of view (FR-048) ---- */
  var U = R.reports.upcomingFitments, booked = facts.filter(function (f) { return f.st === 'scheduled' && f.apptOn; });
  var upFrom = booked.reduce(function (m, f) { return !m || f.apptOn < m ? f.apptOn : m; }, null);
  var upTotal = facts.filter(function (f) { return f.st === 'scheduled'; }).length, upDates = [], shown = 0;
  if (upFrom) for (var i = 0; i < U.horizonDays; i++) {
    var d = addDays(upFrom, i), n = booked.filter(function (f) { return f.apptOn === d; }).length;
    shown += n; upDates.push({ d: d, count: n, share: ratio(n, upTotal) || 0 });
  }
  var upcoming = { from: upFrom, dates: upDates, total: upTotal,
    tail: { label: U.tailLabel, count: upTotal - shown, share: ratio(upTotal - shown, upTotal) || 0 },
    words: 'Upcoming fitments cover all bookings, including rollovers, whatever the view is set to. Dates run from the earliest booking.' };

  /* ---- the scheduler dimension and the four pivots (FR-045, FR-046) ---- */
  var personRows = function (list, op, dim) {
    var key = dim === 'agent' ? 'agent' : dim === 'referrer' ? 'referrer' : 'scheduler';
    var cbKey = dim === 'agent' ? 'agentCb' : dim === 'referrer' ? 'referrerCb' : 'schedulerCb';
    var names = {}; list.forEach(function (f) { if (f[key]) names[f[key]] = 1; });
    return sortedKeys(names).map(function (nm) {
      var mine = list.filter(function (f) { return f[key] === nm; }), mineOp = op.filter(function (f) { return f[key] === nm; });
      var t = tallySet(mine, mineOp);
      t.name = nm; t.cb = (mine[0] || {})[cbKey] || null; t.matched = !!t.cb;
      t.gwpLost = F.gwpLoaded ? sumGwp(mine, function (f) { return f.st === 'cancelled' || f.st === 'missed'; }) : null;
      t.pct = { fitted: ratio(t.fitted, t.sales), scheduled: ratio(t.scheduled, t.sales), cancelled: ratio(t.cancelled, t.sales), missed: ratio(t.missed, t.sales) };
      return t;
    });
  };
  var schRows = personRows(sales, open, 'scheduler');
  var schedulers = {
    loaded: F.schedulersLoaded, rows: schRows, headcount: schRows.length,
    headcountBudget: cb ? cb.headcount : null, headcountCell: cb ? cb.cells.headcount : null,
    unmatched: schRows.filter(function (r) { return !r.matched; }).map(function (r) { return r.name; }),
    words: F.schedulersLoaded ? 'Schedulers come from the Schedulers Data sheet and from nothing else; a name not on the Agent List is counted as typed and listed as unmatched, never guessed away.'
      : 'The scheduler dimension needs the Schedulers Data upload: no daily export names the scheduler, so nothing is painted here.'
  };
  var pivotScope = function (scope) {
    var all = facts, sl = scope === 'all' ? all : all.filter(function (f) { return f.channel === scope; });
    var rows = personRows(sl, sl, 'scheduler').filter(function (r) { return r.sales > 0; });
    /* THE PIVOT'S GRAND TOTAL — the only thing a scheduler row can honestly be read against, because THERE IS NO
       PER-SCHEDULER TARGET IN ANY SOURCE (spec 072 panel 15 / FR-045: the cycle budget carries a scheduler HEADCOUNT
       and nothing else). The page shows the figures and this average and never invents a target. Attached as a
       property of the returned array so every earlier caller — which reduces, maps or filters it — is unmoved. */
    var t = tallySet(sl, sl);
    t.name = 'All schedulers in this scope'; t.k = 'all'; t.cb = null; t.matched = true;
    t.gwpLost = F.gwpLoaded ? sumGwp(sl, function (f) { return f.st === 'cancelled' || f.st === 'missed'; }) : null;
    t.pct = { fitted: ratio(t.fitted, t.sales), scheduled: ratio(t.scheduled, t.sales), cancelled: ratio(t.cancelled, t.sales), missed: ratio(t.missed, t.sales) };
    rows.all = t; rows.scope = scope;
    rows.label = scope === 'all' ? 'All campaigns' : (CH.labels[scope] || scope);
    rows.words = 'Every percentage is over that scheduler\'s own grand total, as the workbook\'s pivots are. The pivots are '
      + 'all data, whatever the view is set to. There is no per-scheduler target in any source — the cycle '
      + 'budget carries a scheduler headcount and nothing else — so the row above is the scope\'s own average and nothing here is a target.';
    return rows;
  };
  var persons = function (dim, filters) {
    var fl = { from: null, to: null, channel: null, campaign: null }, gi = [opts.filters || {}, filters || {}];
    gi.forEach(function (g) { Object.keys(fl).forEach(function (k) { if (g[k] != null) fl[k] = g[k]; }); });
    var keep = function (f) {
      if (fl.from && f.soldOn < fl.from) return false;
      if (fl.to && f.soldOn > fl.to) return false;
      if (fl.channel && f.channel !== fl.channel) return false;
      if (fl.campaign && f.campaign !== fl.campaign) return false;
      return true;
    };
    var sl = sales.filter(keep), op = open.filter(keep), rows = personRows(sl, op, dim);
    var all = tallySet(sl, op);
    all.gwpLost = F.gwpLoaded ? sumGwp(sl, function (f) { return f.st === 'cancelled' || f.st === 'missed'; }) : null;
    all.name = 'All ' + dim + 's'; all.pct = { fitted: ratio(all.fitted, all.sales), scheduled: ratio(all.scheduled, all.sales), cancelled: ratio(all.cancelled, all.sales), missed: ratio(all.missed, all.sales) };
    var on = Object.keys(fl).filter(function (k) { return fl[k] != null; });
    var dd = R.reports.personDimensions.filter(function (p) { return p.k === dim; })[0] || { label: dim };
    return { dim: dim, label: dd.label, rows: rows, all: all, filters: fl,
      words: dd.label + ' over ' + vd.label + '. Active filters: ' + (on.length ? on.map(function (k) { return k + ' = ' + fl[k]; }).join(', ') : 'none') + '.' };
  };

  /* ---- the three integrity checks: engine verdicts, with the words, never colour alone ---- */
  var ichk = { k17: { got: counts.fitted + counts.scheduled + counts.missed + counts.cancelled, expected: counts.sales },
    k18: { got: bkView.total, expected: counts.scheduled },
    schedulerName: { got: schRows.reduce(function (s, r) { return s + r.sales; }, 0), expected: counts.sales } };
  var integrity = R.integrity.map(function (c) {
    var x = ichk[c.k], diff = x.got - x.expected, pass = diff === 0;
    return { k: c.k, label: c.label, formula: c.formula, cell: c.cell, got: x.got, expected: x.expected, diff: diff, ok: pass,
      verdict: pass ? 'OK' : 'CHECK', words: pass ? c.okWords : fill(c.checkWords, { got: fmtN(x.got), expected: fmtN(x.expected), diff: fmtN(Math.abs(diff)) }) };
  });

  /* ---- where the sources disagree: EXTENDING the 071 accounting, never restarting it (FR-014/015) ---- */
  var dir = {}, dtotal = 0;
  sales.forEach(function (f) { if (f.resultRpt && f.resultRpt !== f.st) { var k = f.resultRpt + ' -> ' + f.st; dir[k] = (dir[k] || 0) + 1; dtotal++; } });
  var uSch = {}, uSel = {};
  sales.forEach(function (f) { if (f.scheduler && !f.schedulerCb) uSch[f.scheduler] = 1; if (f.agent && !f.agentCb) uSel[f.agent] = 1; });
  var disagree = {
    resultApplied: R.disagree.resultApplied,
    resultVsEngine: { total: dtotal, share: ratio(dtotal, counts.sales), byDirection: dir },
    unmatchedSchedulers: Object.keys(uSch).length, unmatchedSellers: Object.keys(uSel).length,
    unmappedCampaigns: unmapped.length, unmappedNames: unmapped.slice(),
    noSaleDay: F.noSaleDay, gwpMissing: F.gwpLoaded ? sales.filter(function (f) { return f.gwp == null; }).length : null,
    carried: R.disagree.carried, words: R.disagree.words
  };

  /* ---- Key Insights: templates filled from the figures above, never hand-written (FR-042/043) ---- */
  var leak = counts.cancelled + counts.missed;
  var ranked = campaigns.filter(function (x) { return x.fitRate != null; });
  var src = {
    conversion: counts.sales > 0 ? { fitRate: rates.fitRate, sales: counts.sales, scheduled: counts.scheduled, schedRate: rates.schedRate } : null,
    leakage: counts.sales > 0 ? { leak: leak, leakRate: ratio(leak, counts.sales), leakGwp: gwp.lost, cancelled: counts.cancelled, missed: counts.missed } : null,
    bestCampaign: null,
    rollovers: rollover.totals.sales > 0 ? { total: rollover.totals.sales, fitted: rollover.totals.fitted, open: rollover.totals.open,
      scheduled: rollover.totals.scheduled, rebook: rollover.totals.cancelled + rollover.totals.missed, gwpOpen: rollover.totals.gwpOpen, cycleFrom: cyc.from } : null
  };
  var insights = [];
  R.insights.templates.forEach(function (t) {
    var v = src[t.id];
    if (t.id === 'bestCampaign') {
      var elig = ranked.filter(function (x) { return x.sales >= t.minSales; });
      if (!elig.length) return;
      var hi = elig.slice().sort(function (a, b) { return b.fitRate - a.fitRate || (a.name < b.name ? -1 : 1); })[0];
      var lo = elig.slice().sort(function (a, b) { return a.fitRate - b.fitRate || (a.name < b.name ? -1 : 1); })[0];
      v = { best: hi.name, bestRate: hi.fitRate, worst: lo.name, worstRate: lo.fitRate, minSales: t.minSales, eligible: elig.length };
    }
    if (!v) return;
    var shown = {};
    Object.keys(v).forEach(function (k) {
      var x = v[k];
      shown[k] = typeof x !== 'number' ? x
        : /Rate|Pct|share/.test(k) ? fmtP(x)
          : /Gwp/.test(k) ? fmtR(x) : fmtN(x);
    });
    insights.push({ id: t.id, template: t.text, cell: t.cell, v: v, text: fill(t.text, shown) });
  });

  var model = {
    view: vd.k, viewLabel: vd.label, viewWords: vd.words, viewRule: vd.dateRule,
    openOutcomesInCycleOnly: !!vd.openOutcomesInCycleOnly,
    period: { key: cyc.key, from: cyc.from, to: cyc.to, asOf: asOf, dataThrough: dataThrough, hrsAsAt: hAsAt },
    dataThrough: dataThrough, dialingDays: dialing, counts: counts, rates: rates, budget: budget, forecast: forecast,
    kpis: kpis, weeks: weeks, weekWords: weekWords, channels: byChannel, campaigns: campaigns, campaignRollups: rollups,
    buckets: bkView.rows, bucketsAll: bkAll.rows, bucketsPastDue: bkView.past, bucketWords: bucketWords,
    breakdown: breakdown, breakdownTotals: breakdownTotals, insights: insights, gwp: gwp, rollover: rollover,
    upcoming: upcoming, schedulers: schedulers, schedulerPivot: pivotScope, persons: persons,
    integrity: integrity, disagree: disagree, prevCycle: prevCycle,
    unmapped: unmapped, unmatched: { schedulers: schedulers.unmatched, sellers: Object.keys(uSel).sort() },
    rulesVersion: R.version
  };
  /* SPEC 073: the workbook tabs (VTWorkbook) need the sale facts behind this model - the drill-down lists them, and the
     per-channel lead time, the person rollover and per-campaign columns count them. They ride as NON-enumerable
     properties, so JSON.stringify of a model (the digest, the export, every test that compares models) is unchanged. */
  Object.defineProperty(model, 'facts', { value: facts, enumerable: false });
  Object.defineProperty(model, 'inView', { value: { sales: sales, open: open }, enumerable: false });
  return model;
}

return {
  VT_RULES: VT_RULES, version: R.version, saHolidaysFor: saHolidaysFor, periods: periods, serialToISO: serialToISO, normCB: normCB,
  detect: detect, isBiFittedName: isBiFittedName, extractDate: extractDate, parseBi: parseBi, parseSm: parseSm, parseSchedulers: parseSchedulers, parseRoster: parseRoster,
  normSeller: normSeller, resolveSeller: resolveSeller, leadSourceOf: leadSourceOf, leadGroupOf: leadGroupOf, subOf: subOf,
  emptyBook: emptyBook, merge: merge, bookFromRpc: bookFromRpc, BOOK_COLS: BOOK_COLS, guardUpload: guardUpload,
  cyclesInBook: cyclesInBook, prevCycleFor: prevCycleFor,
  rates: rates, model: model, dashboard: dashboard, cycleBudgetFor: cycleBudgetFor, channelOf: channelOf, rating: rating, bandOf: bandOf, digest: digest, emptyCyclePayload: emptyCyclePayload, uploadGaps: uploadGaps,
  budgetFor: budgetFor, spdBudget: spdBudget
};
});
