import test from 'node:test';
import assert from 'node:assert/strict';
import {filterRoutes, connectRoutes} from '../site/route-map.js';

const ride = (date, route = [[[1, 2], [3, 4]]]) => ({date, route});
test('map filters use ride calendar dates across year boundaries and all-years months', () => {
  const rides = [ride('2025-12-31'), ride('2026-01-01'), ride('2026-12-01'), ride('2026-02-01')];
  assert.deepEqual(filterRoutes(rides, '2026', '01'), [rides[1]]);
  assert.deepEqual(filterRoutes(rides, '', '12'), [rides[0], rides[2]]);
  assert.equal(filterRoutes(rides, '2026').length, 3);
  assert.deepEqual(filterRoutes(rides, '2025', '02'), []);
  assert.deepEqual(filterRoutes(rides), rides);
});

test('selection made before map loads is honored and empty results clear old routes', () => {
  let load, data, breaks, fits = 0;
  const map = {
    on: (event, fn) => { assert.equal(event, 'load'); load = fn; },
    addSource: () => {}, addLayer: () => {},
    getSource: name => ({setData: next => { if(name==='rides')data = next;else breaks=next; }}),
    fitBounds: () => { fits++; }
  };
  class Bounds { extend() {} }
  const old = ride('2025-01-01'), selected = ride('2026-02-01', [[[10, 20], [30, 40]]]);
  const update = connectRoutes(map, Bounds, [old]);
  update([selected]); load();
  assert.deepEqual(data.coordinates, selected.route);
  assert.equal(fits, 1);
  update([]);
  assert.deepEqual(data.coordinates, []);
  assert.deepEqual(breaks.features, []);
  assert.equal(fits, 1);
  update([ride('2026-03-01', []), ride('2026-03-02', [[[10, 20]]])]);
  assert.deepEqual(data.coordinates, []);
  update([old]);
  assert.deepEqual(data.coordinates, old.route);
  assert.equal(fits, 2);
});
