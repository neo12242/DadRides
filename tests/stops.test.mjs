import test from 'node:test';
import assert from 'node:assert/strict';
import {validate} from '../worker.mjs';
import {normalizeStatistics} from '../edits.mjs';
import {visibleStops} from '../stops.mjs';

const ride=()=>({version:1,id:'11111111-1111-4111-8111-111111111111',title:'Pause test',story:'',date:'2026-09-26',tags:[],cover:'',photos:[],
  route:[[[-149,61],[-148,62]]],stops:[{point:[-148,62],durationMs:3600000}],
  stats:{meters:1000,elapsedMs:4200000,movingMs:500000,stoppedMs:100000,unknownMs:0,pausedMs:3600000},privacy:{trimMeters:500,statsIncluded:true}});
test('paused duration is distinct from stopped and missing GPS time',()=>{
  const m=ride();assert.equal(validate(m),m);assert.equal(normalizeStatistics(m.stats).pausedMs,3600000);
  assert.throws(()=>normalizeStatistics({...m.stats,unknownMs:3600000}),/add up/);
});
test('hidden, removed and moved route points cannot keep break coordinates',()=>{
  const m=ride();assert.deepEqual(visibleStops(m.stops,[[[-149,61]]]),[]);
  assert.throws(()=>validate({...m,route:[[[-149,61]]]}),/reviewed route/);
  assert.throws(()=>validate({...m,stops:[{point:[-148,62],durationMs:3600000,time:123}]}),/Invalid break/);
});
test('private totals and route-free publications have no public break pins',()=>{
  const m=ride();assert.throws(()=>validate({...m,stats:{},privacy:{trimMeters:500,statsIncluded:false}}),/Breaks/);
  assert.doesNotThrow(()=>validate({...m,route:[],stops:[],stats:{},privacy:{trimMeters:500,statsIncluded:false}}));
});
test('old ride manifests remain accepted without pause metadata',()=>{
  const m=ride();delete m.stops;delete m.stats.pausedMs;m.stats.unknownMs=3600000;
  assert.doesNotThrow(()=>validate(m));assert.equal(normalizeStatistics(m.stats).unknownMs,3600000);
});
