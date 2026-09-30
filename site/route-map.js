export function filterRoutes(rides, year = '', month = '') {
  // Published dates are calendar dates, not UTC timestamps.
  return rides.filter(ride => (!year || ride.date.slice(0, 4) === year)
    && (!month || ride.date.slice(5, 7) === month));
}

export function connectRoutes(map, MapBounds, initialRides) {
  let rides = initialRides;
  let loaded = false;
  const draw = () => {
    if (!loaded) return;
    const lines = rides.flatMap(ride => ride.route).filter(line => line.length > 1);
    map.getSource('rides').setData({type: 'MultiLineString', coordinates: lines});
    map.getSource('breaks').setData({type:'FeatureCollection',features:rides.flatMap(ride=>(ride.stops||[]).map(stop=>({type:'Feature',geometry:{type:'Point',coordinates:stop.point},properties:{durationMs:stop.durationMs}})))});
    const points = lines.flat();
    if (points.length) {
      const bounds = new MapBounds(points[0], points[0]);
      points.forEach(point => bounds.extend(point));
      map.fitBounds(bounds, {padding: 50, maxZoom: 15, duration: 0});
    }
  };
  map.on('load', () => {
    map.addSource('rides', {type: 'geojson', data: {type: 'MultiLineString', coordinates: []}});
    map.addLayer({id: 'route', type: 'line', source: 'rides', paint: {'line-color': '#d26a37', 'line-width': 4}});
    map.addSource('breaks',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    map.addLayer({id:'break-markers',type:'circle',source:'breaks',paint:{'circle-color':'#ffc154','circle-radius':7,'circle-stroke-color':'#fff','circle-stroke-width':2}});
    loaded = true;
    draw();
  });
  return next => { rides = next; draw(); };
}
