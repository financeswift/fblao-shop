# Magpie Payment Integration Testing & Debugging Guide

## Overview
This guide helps test and troubleshoot Alipay and WeChat payments via Magpie integration.

## Configuration Steps

### 1. Get Magpie API Credentials
1. Sign up at https://www.magpie.im
2. Create an API application in your dashboard
3. Get your **API Key** (public key) and **API Secret** (secret key)
4. Note if you're testing with **Sandbox** or **Live** credentials

### 2. Configure in Admin Panel
1. Go to `https://yourdomain.com/admin` (login with admin credentials)
2. Navigate to **Settings** → **Magpie (Alipay / WeChat Pay)**
3. Fill in the configuration:
   - **Enabled**: Check the box
   - **Mode**: Select "Sandbox" for testing, "Live" for production
   - **API Base URL**: Leave blank (uses defaults for sandbox/live)
   - **API Key**: Paste your public API key
   - **API Secret**: Paste your secret API key  
   - **Webhook Secret**: Optional, for webhook verification
   - **Target Currency**: Default "CNY" (Chinese Yuan)
4. Click "Save Magpie configuration"

### 3. Register Webhook URL (Optional but Recommended)
In your Magpie dashboard:
- Register webhook URL: `https://yourdomain.com/webhooks/magpie`
- Set webhook secret in the admin settings if provided by Magpie

## Testing the Integration

### Quick Test via Admin Page
After configuration:
1. Go back to Admin Settings → Magpie
2. The connection test should show:
   - ✓ Configuration status
   - ✓ API key format validation
   - ✓ Connectivity test results

### Manual Payment Test
1. Go to the shop homepage
2. Select a product
3. Enter your Telegram username
4. Choose **Alipay** or **WeChat Pay** as payment method
5. Click "Pay"

**Expected Flow:**
- Order is created with reference number (e.g., `TEST-001`)
- Redirected to Magpie checkout page
- Magpie displays payment options (Alipay/WeChat QR code)
- After payment, redirected back to result page
- Order status should update to "paid"

### Expected Responses & Troubleshooting

#### Issue: "Magpie payment is not available right now"
**Cause:** API keys not configured or set to placeholder values
**Fix:**
- Check Admin → Settings → Magpie
- Verify API Key is not "your-magpie-api-key" or empty
- Verify API Secret is set correctly
- Ensure "Enabled" checkbox is checked

#### Issue: "Authentication failed (401)"
**Cause:** Invalid or expired API credentials
**Fix:**
- Verify API Key/Secret in your Magpie dashboard
- Ensure you're using the correct sandbox/live keys for the selected mode
- Check if credentials have been revoked
- Get fresh keys from Magpie dashboard

#### Issue: "Internal server error" (500)
**Cause:** API request structure might be wrong, or API has changed
**Fix:**
- Check browser console for exact error message
- Check application logs: `docker logs <container>` (if using Railway, check build logs)
- Verify order amount is valid (must be > 0)
- Verify currency code is in correct format (e.g., "CNY", "PHP")

#### Issue: "Magpie response missing checkout URL"
**Cause:** API response doesn't contain expected checkout URL
**Fix:**
- Verify order data is being sent correctly to API
- Check Magpie API response format matches expected schema
- Contact Magpie support to verify API is working

## Log Analysis

When troubleshooting, look for these in your application logs:

```
[Magpie] Source creation failed: { status: 401, ... }
[Magpie] Charge creation failed: { status: 500, ... }
[Magpie] Authentication failed: Check your API key configuration
```

Each log entry includes:
- HTTP status code
- API response details
- Payload that was sent (for debugging)

## Currency Conversion

The app automatically converts order amounts from store currency (PHP) to Magpie target currency (default CNY):

1. **Conversion Rates:** Fetched from er-api.com (free tier)
2. **Caching:** Rates cached for 10 minutes (configurable)
3. **Fallback:** If conversion fails, original currency is used

To test currency conversion:
- Place an order in PHP
- Check admin panel → order details
- Verify converted amount in CNY is reasonable

Example: ₱500 PHP ≈ ¥75 CNY (approximate)

## Payment Status Verification

### Via Webhook
When payment is completed, Magpie sends a webhook to `/webhooks/magpie`:

```json
{
  "id": "charge_123",
  "status": "paid",
  "referenceNumber": "ORDER-001",
  "source": { "redirect": { "checkout_url": "..." } }
}
```

### Via Admin Panel
1. Go to Admin → Orders
2. Find your test order
3. Status should show "paid" after successful payment
4. Webhook delivery can be verified in Magpie dashboard

## Testing Alipay vs WeChat

### Alipay Payment Flow
1. Select "Alipay" payment option
2. Click "Pay" → Magpie checkout page
3. See Alipay option
4. Scan QR code or login with Alipay
5. Verify payment completes

### WeChat Pay Flow
1. Select "WeChat Pay" payment option
2. Click "Pay" → Magpie checkout page
3. See WeChat Pay option
4. Scan QR code with WeChat app
5. Verify payment completes

Both should follow the same checkout flow with different payment providers.

## Environment Variables (Alternative to Admin Settings)

If using environment variables (`.env` file):

```env
MAGPIE_ENABLED=1
MAGPIE_MODE=sandbox                  # or 'live'
MAGPIE_API_KEY=your-actual-key-here
MAGPIE_API_SECRET=your-actual-secret-here
MAGPIE_WEBHOOK_SECRET=optional-webhook-secret
MAGPIE_TARGET_CURRENCY=CNY           # default, can override
```

Note: Admin settings override environment variables after first run.

## Common Issues & Solutions

| Issue | Possible Cause | Solution |
|-------|---|---|
| 401 Authentication | Invalid API key | Regenerate from Magpie dashboard |
| 403 Forbidden | Wrong authentication header | Verify Bearer token format |
| 404 Not Found | Sandbox endpoint issue | Try switching to Live mode temporarily |
| 500 Error | API internal error | Contact Magpie support |
| Order not marked paid | Webhook not configured | Register webhook URL in Magpie dashboard |
| Currency mismatch | Conversion failed | Check exchange rate API availability |

## Support Resources

- **Magpie Documentation:** https://www.magpie.im/docs
- **Sandbox Testing:** https://api-sandbox.magpie.im
- **Live API:** https://api.magpie.im
- **Support Email:** support@magpie.im

## Testing Checklist

- [ ] API keys obtained from Magpie
- [ ] Sandbox/Live mode selected correctly
- [ ] Admin settings saved without errors
- [ ] Webhook URL registered (optional)
- [ ] Test Alipay payment flow
- [ ] Test WeChat payment flow
- [ ] Order marked as paid after payment
- [ ] Currency conversion works
- [ ] Error messages are clear

## Next Steps

1. **If payments work:** Keep current configuration and monitor webhook deliveries
2. **If payments fail:** Check logs, verify API keys, contact Magpie support
3. **For production:** Switch to Live mode and verify with real credentials
4. **Monitor:** Set up alerts for failed payments in Admin → Orders
