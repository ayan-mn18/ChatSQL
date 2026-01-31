/**
 * Script to list all Dodo Payments products
 * Run: npx ts-node src/scripts/list-dodo-products.ts
 */

import DodoPayments from 'dodopayments';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../.env') });

const DODO_PAYMENTS_API_KEY = process.env.DODO_PAYMENTS_API_KEY;
const DODO_PAYMENTS_MODE = process.env.DODO_PAYMENTS_MODE || 'test_mode';

async function listProducts(): Promise<void> {
  if (!DODO_PAYMENTS_API_KEY) {
    console.error('❌ DODO_PAYMENTS_API_KEY is not set');
    process.exit(1);
  }

  console.log('🔍 Listing Dodo Payments products...');
  console.log(`📌 Mode: ${DODO_PAYMENTS_MODE}`);
  console.log(`🔑 API Key: ${DODO_PAYMENTS_API_KEY.substring(0, 15)}...`);
  console.log('');

  const client = new DodoPayments({
    bearerToken: DODO_PAYMENTS_API_KEY,
    environment: DODO_PAYMENTS_MODE === 'live_mode' ? 'live_mode' : 'test_mode',
  });

  try {
    console.log('📋 Fetching products...\n');
    
    const products = await client.products.list();
    
    if (!products || products.items.length === 0) {
      console.log('⚠️  No products found in this account/mode');
      console.log('\nMake sure:');
      console.log('1. Products were created in the same mode (test/live) as your API key');
      console.log('2. Your API key has permissions to list products');
      return;
    }

    console.log(`Found ${products.items.length} product(s):\n`);
    console.log('='.repeat(80));
    
    for (const product of products.items) {
      console.log(`\n📦 ${product.name || 'Unnamed Product'}`);
      console.log(`   ID: ${product.product_id}`);
      console.log(`   Price: ${product.price ? `$${(product.price / 100).toFixed(2)} ${product.currency}` : 'N/A'}`);
      console.log(`   Recurring: ${product.is_recurring ? 'Yes' : 'No'}`);
      console.log(`   Created: ${product.created_at}`);
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('\n✅ Product IDs for .env:\n');
    
    for (const product of products.items) {
      const name = (product.name || '').toLowerCase();
      if (name.includes('monthly')) {
        console.log(`DODO_PRODUCT_ID_PRO_MONTHLY=${product.product_id}`);
      } else if (name.includes('yearly') || name.includes('annual')) {
        console.log(`DODO_PRODUCT_ID_PRO_YEARLY=${product.product_id}`);
      } else if (name.includes('lifetime')) {
        console.log(`DODO_PRODUCT_ID_LIFETIME=${product.product_id}`);
      } else {
        console.log(`# Unknown: ${product.name} = ${product.product_id}`);
      }
    }

  } catch (error: any) {
    console.error('\n❌ Failed to list products:', error.message);
    if (error.status) {
      console.error(`   Status: ${error.status}`);
    }
    if (error.error) {
      console.error('   Details:', JSON.stringify(error.error, null, 2));
    }
  }
}

listProducts();
