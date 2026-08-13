# Logo Upload Folder

Upload official payment & bank logos here before moving them to `public/img/payments/`.

## How to use:

1. **Download official logos** from the sources listed in `OFFICIAL_LOGOS_GUIDE.md`
2. **Upload/paste them here** (PNG, SVG, or JPG formats supported)
3. **Organize by payment method** (e.g., `gcash-official.svg`, `maya-official.png`, etc.)
4. **Convert if needed** (convert PNG to SVG using online tools or SVGO)
5. **Move to production** once verified:
   ```bash
   cp logos-upload/gcash-official.svg public/img/payments/gcash.svg
   cp logos-upload/maya-official.svg public/img/payments/maya.svg
   # etc...
   ```

## File naming convention:

- `{payment-method}-official.{ext}`
- Examples: `gcash-official.svg`, `bpi-official.png`, `alipay-official.svg`

## Logos to prioritize:

**E-Wallets (Philippine):**
- GCash
- Maya
- GrabPay
- ShopeePay

**Philippine Banks:**
- BPI
- UnionBank
- BDO
- RCBC
- PNB

**International:**
- Alipay
- WeChat Pay
- PayPal

**Card Networks:**
- Visa
- Mastercard
- Amex
- JCB

## Tips:

- Use SVG format when possible (scalable, smaller file size)
- Ensure transparent backgrounds for better integration
- Test on both light and dark backgrounds
- Verify sizing at different screen breakpoints
- Check brand guidelines for usage rights

---

Once tested and approved, move logos to: `public/img/payments/`
