import {handle} from './worker.mjs';
export default {fetch(request,env){return new URL(request.url).pathname.startsWith('/api/')?handle(request,env):env.ASSETS.fetch(request)}};
