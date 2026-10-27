import cloud from 'wx-server-sdk';
import { createRepository, createStorage } from './adapter';
import { cleanupGarments } from './wardrobe-service';

cloud.init({ env: 'wardrobe-dev-cloude-d5bv128b6099' });
export async function cleanup() {
  // Deployment rules must deny client invocation; this is timer/admin-only.
  return cleanupGarments(createRepository(), createStorage());
}
