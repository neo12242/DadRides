import {test} from 'node:test';
import assert from 'node:assert/strict';
import {serviceSummary,serviceCountdown} from '../site/services.js';
const mile=1.609344;
function fixture(){return {serviceTypes:[{id:'oil',name:'Engine oil & filter',enabled:true,configured:true,intervalKm:1000*mile,intervalDays:46}],fuel:[{id:'reading',odometerKm:151*mile}],maintenance:[],conflicts:[],serviceBaselines:[{id:'oil',date:'2026-09-22',odometerKm:mile,enabled:true}]}}
test('shows remaining mileage, target odometer and calendar days together',()=>{
  const item=serviceSummary(fixture(),new Date(2026,8,26,18).getTime()).items[0];
  assert.ok(Math.abs(item.remaining/mile-850)<1e-9);assert.ok(Math.abs(item.dueOdometer/mile-1001)<1e-9);
  assert.equal(item.daysRemaining,42);assert.equal(new Date(item.due).getDate(),7);
  assert.deepEqual(serviceCountdown(item),{mileage:'850.0 miles remaining',time:'42 days remaining'});
});
test('due-now and due-today are distinct from overdue',()=>{
  const data=fixture();data.fuel[0].odometerKm=1001*mile;
  let item=serviceSummary(data,new Date(2026,10,7,23).getTime()).items[0];
  assert.deepEqual(serviceCountdown(item),{mileage:'Due now',time:'Due today'});
  data.fuel[0].odometerKm=1026*mile;
  item=serviceSummary(data,new Date(2026,10,8,1).getTime()).items[0];
  assert.deepEqual(serviceCountdown(item),{mileage:'Overdue by 25.0 miles',time:'Overdue by 1 day'});
});
test('missing baselines and unset individual intervals remain explicit',()=>{
  const data=fixture();data.serviceBaselines=[];
  let item=serviceSummary(data).items[0];assert.equal(item.dueOdometer,null);assert.equal(item.daysRemaining,null);
  assert.deepEqual(serviceCountdown(item),{mileage:'Service baseline or odometer needed',time:'Service baseline needed'});
  data.serviceTypes[0].intervalKm=0;data.serviceTypes[0].intervalDays=0;
  item=serviceSummary(data).items[0];assert.deepEqual(serviceCountdown(item),{mileage:'Mileage interval not set',time:'Time interval not set'});
});
test('calendar-day countdown does not round incorrectly over DST transitions',()=>{
  const previous=process.env.TZ;process.env.TZ='America/Anchorage';
  try{
    const data=fixture();data.serviceBaselines[0].date='2026-10-31';data.serviceTypes[0].intervalDays=2;
    let item=serviceSummary(data,new Date(2026,9,31,23,50).getTime()).items[0];assert.equal(item.daysRemaining,2);
    item=serviceSummary(data,new Date(2026,10,1,23,50).getTime()).items[0];assert.equal(item.daysRemaining,1);assert.equal(serviceCountdown(item).time,'1 day remaining');
  }finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous}
});
test('actual service supplies both targets and conflicts remain flagged',()=>{
  const data=fixture();data.serviceTypes[0].intervalDays=10;data.maintenance=[{id:'service',serviceId:'oil',odometerKm:100*mile,time:new Date(2026,8,25).getTime()}];
  let item=serviceSummary(data,new Date(2026,8,26).getTime()).items[0];
  assert.ok(Math.abs(item.dueOdometer/mile-1100)<1e-9);assert.equal(item.daysRemaining,9);assert.equal(item.due,data.maintenance[0].time+10*86400000);assert.equal(item.newBike,null);
  data.conflicts=['software/maintenance/service'];assert.equal(serviceSummary(data).items[0].status,'Resolve app conflicts');
});
