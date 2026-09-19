import { auth } from '../_middleware.js';
export const onRequestPost = auth.pair;
