import { auth } from './_middleware.js';
export const onRequestGet = auth.claim;
