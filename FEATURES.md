# BlackHorse Digital Storefront — Complete Feature List

**A production-ready, all-in-one digital goods e-commerce platform with 7 payment processors, admin dashboard, and zero build dependencies.**

---

## 🛍️ **Core Storefront Features**

### Customer-Facing
- **Homepage with Category Browsing** — Products organized in categories with stock visibility
- **Product Listings** — Display name, description, price, and real-time stock counts
- **Announcement Banners** — Admin-controlled announcements/promotions on homepage
- **Purchase Modal** — Quick checkout flow: email, quantity, payment method selection
- **Order Tracking** — Customers query orders with email + order number
- **Live Result Page** — Instant delivery of digital goods after payment confirmation
- **Responsive Design** — Mobile-friendly, modern UI with payment partner logos
- **Auto-Delivery** — Configurable per-product automatic delivery of digital content

### Security & Compliance
- ✅ CSRF Protection on all forms
- ✅ XSS Prevention with HTML escaping
- ✅ Secure session management (HTTPOnly cookies)
- ✅ Rate limiting on login and order creation
- ✅ HTTPS enforcement in production
- ✅ Password hashing with bcryptjs
- ✅ Payload size limits (10KB default)

---

## 💳 **Payment Processing (7 Gateways)**

### 1. **Maya Checkout** (Philippines-focused)
- Full-page hosted checkout
- Webhook HMAC verification
- Real-time status polling
- Sandbox & Live modes
- Automatic order status sync

### 2. **Swiftpay PH** (Philippine Banks + E-wallets)
- **Direct bank redirects:** BPI, BDO, RCBC, Union Bank, Metrobank, Landbank, BPI Family Savings
- **E-wallets:** Maya, GCash (via QR Ph)
- **InstaPay/PESONet:** QR Ph integration
- Hosted checkout with custom redirect URLs
- HMAC webhook verification
- Sandbox & Live modes

### 3. **Magpie** (Alipay & WeChat Pay)
- **Alipay checkout** — Chinese buyer support
- **WeChat Pay checkout** — QR code scanning
- Currency conversion (PHP to CNY)
- Webhook HMAC verification
- Sandbox & Live modes

### 4. **PayMongo** (Philippines - Cards + GCash)
- Card payments (Visa/Mastercard)
- GCash mobile wallet
- Hosted checkout pages
- Webhook signature verification

### 5. **Xendit** (Multi-currency, Multi-region)
- Invoice-based payments
- Multiple payment methods per invoice
- Webhook callback verification
- Sandbox & Live modes

### 6. **Coins.ph** (Philippines - Wallet + Bank)
- Coins digital wallet
- Bank transfers
- OTC (over-the-counter) payments
- Webhook verification

### 7. **Manual Payment Methods** (Bank Transfer, GCash, etc.)
- Admin-defined payment instructions
- Display to customer after order placement
- Manual payment method icons
- Admin marks orders as paid manually

---

## 🎛️ **Admin Dashboard**

### Dashboard Overview
- **Order Statistics** — Total, pending, paid, delivered counts
- **Quick Stats** — Revenue, stock status at-a-glance

### Product Management
- ✅ Create/edit/delete products
- ✅ Category management
- ✅ Stock tracking
- ✅ Price management
- ✅ Product descriptions
- ✅ Sort/reorder products
- ✅ Active/inactive toggle
- ✅ Auto-delivery configuration per product
- ✅ Bulk stock operations

### Stock Pool Management
- ✅ Add accounts to stock pool (one per line)
- ✅ Track which accounts are sold/unsold
- ✅ Automatic depletion on delivery
- ✅ Manual stock management

### Order Management
- ✅ View all orders with full details
- ✅ Filter by status (pending, paid, delivered, failed)
- ✅ Search by order number, email, Telegram username
- ✅ Order timeline (created → paid → delivered)
- ✅ Mark orders as paid (manual methods)
- ✅ Deliver content with account credentials
- ✅ Admin notes per order
- ✅ View customer delivery history
- ✅ Order audit log (status changes tracked)

### Payment Configuration
- ✅ Enable/disable each payment processor
- ✅ API keys/secrets per gateway
- ✅ Sandbox/Live mode toggle
- ✅ Webhook secret configuration
- ✅ Custom redirect URLs (Swiftpay)
- ✅ Test payment button per method

### Shop Settings
- ✅ Shop name & branding
- ✅ Currency selection
- ✅ Logo upload (custom branding)
- ✅ Session secret management
- ✅ Admin credentials change
- ✅ Settings persist across deployments

### Content Management
- ✅ Banner creation/editing
- ✅ Banner enable/disable
- ✅ Banner sort order (homepage display)
- ✅ Manual payment method icons/instructions

### Notifications (Optional)
- ✅ Telegram bot integration
- ✅ Admin notifications for new orders
- ✅ Customer notifications via Telegram

---

## 💾 **Database & Data Management**

### SQLite Database
- ✅ Zero-configuration (embedded, no server needed)
- ✅ WAL mode (Write-Ahead Logging) for concurrency
- ✅ Foreign key constraints enabled
- ✅ Full-text search capable
- ✅ Automatic backups support
- ✅ Persistent storage on Railway volumes

### Data Models
- **Settings** — Shop configuration, API keys
- **Admins** — Admin accounts with secure password hashing
- **Categories** — Product organization
- **Products** — Item listing with stock & pricing
- **Product Stock Pool** — Account inventory management
- **Manual Payment Methods** — Custom payment instructions
- **Banners** — Homepage announcements
- **Orders** — Complete order lifecycle tracking
- **Order Audit Log** — Full change history for compliance

### Data Export/Restore
- ✅ Database backup/restore from admin panel
- ✅ SQL dump compatible format
- ✅ Point-in-time recovery support

---

## 🔧 **Technical Features**

### Architecture
- **Framework:** Node.js + Express (no build step)
- **Template Engine:** EJS (server-side rendering)
- **Database:** SQLite with node:sqlite (native, built-in)
- **No compilation needed** — runs on Node 22.5+

### Deployment
- ✅ **Railway-ready** — nixpacks.toml included
- ✅ **Docker-compatible**
- ✅ **Persistent volumes** for data survival
- ✅ **Health check endpoint** (/health)
- ✅ **Environment variable configuration**
- ✅ **Automatic restarts on failure**

### Webhook System
- ✅ Verified webhook handlers for all 7 payment processors
- ✅ HMAC signature verification
- ✅ Automatic order status updates
- ✅ Idempotent webhook processing
- ✅ Error logging and debugging

### API Integration
- ✅ RESTful order creation
- ✅ Payment status polling
- ✅ Webhook endpoints for async notifications
- ✅ Error handling and retry logic

---

## 📊 **Reporting & Analytics**

### Order Reports
- ✅ Order statistics by status
- ✅ Revenue calculation (with currency support)
- ✅ Stock depletion tracking
- ✅ Payment method popularity metrics
- ✅ Order timeline (created → paid → delivered)

### Audit Trail
- ✅ Order status change history
- ✅ Admin action logging
- ✅ Timestamp tracking
- ✅ Admin attribution per change

---

## 🌍 **Internationalization**

### Multi-Currency Support
- ✅ Currency selection at shop level
- ✅ Magpie currency conversion (PHP ↔ CNY)
- ✅ Display prices in shop currency
- ✅ Store prices in order history

### Multi-Language Support
- ✅ EJS template-based (easily customizable)
- ✅ English default, extendable to any language

### Regional Features
- ✅ Philippines-focused payment processors (Maya, Swiftpay, Coins)
- ✅ Chinese payment support (Magpie - Alipay/WeChat)
- ✅ International payments (Xendit, PayMongo)

---

## 📱 **Integrations**

### Telegram Bot (Optional)
- ✅ Admin order notifications
- ✅ Customer query responses
- ✅ Order status updates
- ✅ Notification preferences

### Payment Processor APIs
- ✅ Maya Business API
- ✅ Swiftpay API
- ✅ Magpie API
- ✅ PayMongo API
- ✅ Xendit API
- ✅ Coins.ph API

### Session Storage
- ✅ File-based sessions (production-ready)
- ✅ Persistent across restarts
- ✅ TTL management (8-hour default)

---

## 🔐 **Security Features**

### Authentication & Authorization
- ✅ Admin login with bcrypt password hashing
- ✅ Session-based authentication
- ✅ Rate limiting (login, order creation)
- ✅ Admin-only routes enforcement

### Data Protection
- ✅ CSRF tokens on all forms
- ✅ XSS prevention with HTML escaping
- ✅ SQL injection protection (parameterized queries)
- ✅ HTTPOnly session cookies
- ✅ Secure/SameSite cookie flags in production

### API Security
- ✅ HMAC webhook signature verification
- ✅ Raw body capture for signature validation
- ✅ Payload size limits
- ✅ Headers: X-Content-Type-Options, X-Frame-Options, X-XSS-Protection

### Secrets Management
- ✅ Environment variable configuration
- ✅ No hardcoded API keys
- ✅ Session secret rotation support
- ✅ Separate production/sandbox credentials

---

## 📈 **Scalability & Performance**

### Database Optimization
- ✅ Indexed queries for fast lookups
- ✅ Connection pooling
- ✅ WAL mode for concurrent access
- ✅ Prepared statement support

### Caching
- ✅ Settings caching in middleware
- ✅ Shop context passed to all templates
- ✅ Efficient category/product queries

### Load Handling
- ✅ Rate limiting middleware
- ✅ Payload size limits
- ✅ Async/await for non-blocking operations
- ✅ Error recovery mechanisms

---

## 🚀 **Developer Features**

### Easy Customization
- ✅ EJS templates (simple HTML + logic)
- ✅ CSS in `/public/css/` (easy to customize)
- ✅ Configuration via `.env` or Admin UI
- ✅ Clear code organization

### Debugging
- ✅ Comprehensive error pages
- ✅ Console logging
- ✅ Webhook debugging info
- ✅ Payment status testing in admin

### Documentation
- ✅ README with setup instructions
- ✅ Environment variable guide
- ✅ Payment processor setup guides
- ✅ API integration documentation
- ✅ Inline code comments

### Testing
- ✅ Health check endpoint
- ✅ Payment method test buttons
- ✅ Order query testing (email + order #)
- ✅ Test webhook endpoints

---

## 📦 **What's Included**

- ✅ Full source code (Node.js + Express + SQLite)
- ✅ Admin dashboard (responsive, modern UI)
- ✅ 7 payment processor integrations
- ✅ Deployment configuration (Railway/Docker)
- ✅ Database schema and migrations
- ✅ Security best practices built-in
- ✅ Complete documentation
- ✅ Example .env configuration
- ✅ CSS styling (easily customizable)
- ✅ No npm build step (runs as-is)

---

## 🎯 **Use Cases**

1. **Digital Goods Store** — Accounts, credentials, software licenses, subscriptions
2. **Facebook Account Shop** — BMs, aged accounts, accounts with followers/engagement
3. **Email/SIM Services** — Bulk email lists, verified phone numbers
4. **Course Platform** — Online courses with access credentials
5. **Software Licensing** — License keys, activation codes
6. **API Reseller** — API tokens, credentials distribution
7. **Gaming Account Shop** — Game accounts, cosmetics delivery
8. **Premium Content** — eBooks, templates, resources

---

## 💪 **Why BlackHorse?**

- **Zero Dependencies** — No build step, no Webpack, no complex tooling
- **Production Ready** — Security hardened, audit logging, error handling
- **Multi-Gateway** — 7 payment processors supported out-of-the-box
- **Easy to Deploy** — Railway-ready, Docker-compatible, persistent storage
- **Customizable** — Simple EJS templates, pure CSS, easy to modify
- **Secure** — CSRF protection, HMAC verification, rate limiting
- **Extensible** — Clear code structure, easy to add new payment methods
- **Admin-Friendly** — No database queries needed, manage everything via UI
- **Customer-Centric** — Auto-delivery, order tracking, Telegram notifications
- **Developer-Friendly** — Clear error messages, debugging tools, good documentation

---

**Ready to launch your digital goods store? BlackHorse has everything you need.** 🐎

