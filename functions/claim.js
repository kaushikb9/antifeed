import { auth } from './_middleware.js';
export const onRequestGet = auth.claim;
export const onRequestPost = auth.claim;
