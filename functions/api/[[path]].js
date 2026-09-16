import {handle} from '../../worker.mjs';
export const onRequest = ({request,env}) => handle(request,env);
