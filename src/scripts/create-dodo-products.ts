/**
 * Script to create Dodo Payments products
 * Run this once to create products and get their IDs
 * 
 * Usage: npx ts-node src/scripts/create-dodo-products.ts
 */

import DodoPayments from 'dodopayments';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../.env') });

const DODO_PAYMENTS_API_KEY = process.env.DODO_PAYMENTS_API_KEY;
const DODO_PAYMENTS_MODE = process.env.DODO_PAYMENTS_MODE || 'test';

interface ProductResult {
  name: string;
  product_id: string;
  price: number;
  currency: string;
  type: 'one_time' | 'recurring';
  interval?: string;
}

async function createProducts(): Promise<void> {
  if (!DODO_PAYMENTS_API_KEY) {
    console.error('❌ DODO_PAYMENTS_API_KEY is not set in .env file');
    process.exit(1);
  }

  console.log('🚀 Creating Dodo Payments products...');
  console.log(`📌 Mode: ${DODO_PAYMENTS_MODE}`);
  console.log('');

  const client = new DodoPayments({
    bearerToken: DODO_PAYMENTS_API_KEY,
    environment: DODO_PAYMENTS_MODE === 'live' ? 'live_mode' : 'test_mode',
  });

  const createdProducts: ProductResult[] = [];

  try {
    // 1. Create Pro Monthly - $10/month
    console.log('📦 Creating Pro Monthly ($10/month)...');
    const proMonthly = await client.products.create({
      name: 'ChatSQL Pro Monthly',
      description: 'ChatSQL Pro Plan - Monthly subscription with unlimited AI queries, priority support, and advanced features.',
      tax_category: 'digital_products',
      price: {
        type: 'recurring_price',
        currency: 'USD',
        price: 1000, // $10.00 in cents
        discount: 0,
        purchasing_power_parity: false,
        payment_frequency_count: 1,
        payment_frequency_interval: 'Month',
        subscription_period_count: 1,
        subscription_period_interval: 'Month',
        trial_period_days: 0,
      },
      metadata: {
        plan_type: 'pro_monthly',
        tier: 'pro',
      },
    });
    console.log(`   ✅ Created: ${proMonthly.product_id}`);
    createdProducts.push({
      name: 'Pro Monthly',
      product_id: proMonthly.product_id,
      price: 1000,
      currency: 'USD',
      type: 'recurring',
      interval: 'month',
    });

    // 2. Create Pro Yearly - $8/month ($96/year)
    console.log('📦 Creating Pro Yearly ($8/month, billed annually)...');
    const proYearly = await client.products.create({
      name: 'ChatSQL Pro Yearly',
      description: 'ChatSQL Pro Plan - Annual subscription at a discounted rate. Save 20% compared to monthly!',
      tax_category: 'digital_products',
      price: {
        type: 'recurring_price',
        currency: 'USD',
        price: 9600, // $96.00 in cents ($8/month * 12)
        discount: 0,
        purchasing_power_parity: false,
        payment_frequency_count: 1,
        payment_frequency_interval: 'Year',
        subscription_period_count: 1,
        subscription_period_interval: 'Year',
        trial_period_days: 0,
      },
      metadata: {
        plan_type: 'pro_yearly',
        tier: 'pro',
        monthly_equivalent: '8',
      },
    });
    console.log(`   ✅ Created: ${proYearly.product_id}`);
    createdProducts.push({
      name: 'Pro Yearly',
      product_id: proYearly.product_id,
      price: 9600,
      currency: 'USD',
      type: 'recurring',
      interval: 'year',
    });

    // 3. Create Lifetime - $100 one-time
    console.log('📦 Creating Lifetime ($100 one-time)...');
    const lifetime = await client.products.create({
      name: 'ChatSQL Lifetime',
      description: 'ChatSQL Lifetime Access - One-time payment for permanent access to all Pro features. Never pay again!',
      tax_category: 'digital_products',
      price: {
        type: 'one_time_price',
        currency: 'USD',
        price: 10000, // $100.00 in cents
        discount: 0,
        purchasing_power_parity: false,
        pay_what_you_want: false,
      },
      metadata: {
        plan_type: 'lifetime',
        tier: 'lifetime',
      },
    });
    console.log(`   ✅ Created: ${lifetime.product_id}`);
    createdProducts.push({
      name: 'Lifetime',
      product_id: lifetime.product_id,
      price: 10000,
      currency: 'USD',
      type: 'one_time',
    });

    // Output results
    console.log('\n' + '='.repeat(60));
    console.log('🎉 ALL PRODUCTS CREATED SUCCESSFULLY!');
    console.log('='.repeat(60) + '\n');

    console.log('📋 Product IDs (add these to your .env file):\n');
    console.log(`DODO_PRODUCT_ID_PRO_MONTHLY=${createdProducts[0].product_id}`);
    console.log(`DODO_PRODUCT_ID_PRO_YEARLY=${createdProducts[1].product_id}`);
    console.log(`DODO_PRODUCT_ID_LIFETIME=${createdProducts[2].product_id}`);

    // Save to a JSON file for reference
    const outputPath = path.join(__dirname, '../../dodo-products.json');
    fs.writeFileSync(outputPath, JSON.stringify({
      mode: DODO_PAYMENTS_MODE,
      created_at: new Date().toISOString(),
      products: createdProducts,
      env_variables: {
        DODO_PRODUCT_ID_PRO_MONTHLY: createdProducts[0].product_id,
        DODO_PRODUCT_ID_PRO_YEARLY: createdProducts[1].product_id,
        DODO_PRODUCT_ID_LIFETIME: createdProducts[2].product_id,
      }
    }, null, 2));
    console.log(`\n📁 Product details saved to: ${outputPath}`);

    console.log('\n' + '='.repeat(60));
    console.log('📌 NEXT STEPS:');
    console.log('='.repeat(60));
    console.log('1. Copy the product IDs above to your .env file');
    console.log('2. Restart your server');
    console.log('3. Test the checkout flow');
    console.log('='.repeat(60) + '\n');

  } catch (error: any) {
    console.error('\n❌ Failed to create products:', error.message);
    if (error.status) {
      console.error(`   Status: ${error.status}`);
    }
    if (error.error) {
      console.error('   Details:', JSON.stringify(error.error, null, 2));
    }
    process.exit(1);
  }
}

// Run the script
createProducts();
