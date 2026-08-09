(function () {
  'use strict';

  // --- Scroll-aware sticky header ---
  var siteHeader = document.querySelector('.site-header');
  if (siteHeader) {
    function updateHeaderShadow() {
      if (window.scrollY > 4) {
        siteHeader.classList.add('is-scrolled');
      } else {
        siteHeader.classList.remove('is-scrolled');
      }
    }
    window.addEventListener('scroll', updateHeaderShadow, { passive: true });
    updateHeaderShadow();
  }

  // --- Live Clock ---
  function updateClock() {
    var el = document.getElementById('live-clock');
    if (!el) return;
    var now = new Date();
    try {
      el.textContent = now.toLocaleString('en-PH', {
        timeZone: 'Asia/Manila',
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
    } catch (e) {
      el.textContent = now.toLocaleString();
    }
  }
  updateClock();
  setInterval(updateClock, 1000);

  var currencyCode = (document.body && document.body.getAttribute('data-currency')) || 'PHP';
  currencyCode = String(currencyCode).toUpperCase();

  function fmt(n) {
    var symbolMap = { PHP: '₱', CNY: '¥', CNH: '¥', RMB: '¥', USD: '$' };
    var localeMap = { PHP: 'en-PH', CNY: 'zh-CN', CNH: 'zh-CN', RMB: 'zh-CN', USD: 'en-US' };
    var symbol = symbolMap[currencyCode] || '';
    var locale = localeMap[currencyCode] || 'en-PH';
    var formatted = Number(n).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return symbol ? symbol + formatted : formatted + ' ' + currencyCode;
  }

  // --- Catalog Filters ---
  var filterForm = document.getElementById('catalogFilters');
  if (filterForm) {
    var searchInput = document.getElementById('catalogSearch');
    var minPriceInput = document.getElementById('catalogMinPrice');
    var maxPriceInput = document.getElementById('catalogMaxPrice');
    var inStockInput = document.getElementById('catalogInStock');
    var categorySelect = document.getElementById('catalogCategory');
    var sortSelect = document.getElementById('catalogSort');
    var clearFiltersBtn = document.getElementById('catalogFilterClear');
    var clearEmptyBtn = document.getElementById('catalogFilterEmptyClear');
    var summaryEl = document.getElementById('catalogFilterSummary');
    var emptyEl = document.getElementById('catalogFilterEmpty');
    var categoryBlocks = Array.prototype.slice.call(document.querySelectorAll('[data-category-block]'));
    var productRows = Array.prototype.slice.call(document.querySelectorAll('[data-product-row]'));
    var totalProducts = productRows.length;

    function normalize(value) {
      return String(value || '').toLowerCase().trim();
    }

    function applyCatalogFilters() {
      var search = normalize(searchInput ? searchInput.value : '');
      var minPrice = (minPriceInput && minPriceInput.value !== '') ? parseFloat(minPriceInput.value) : null;
      var maxPrice = (maxPriceInput && maxPriceInput.value !== '') ? parseFloat(maxPriceInput.value) : null;
      var onlyInStock = !!(inStockInput && inStockInput.checked);
      var categoryFilter = categorySelect ? normalize(categorySelect.value) : '';
      var sortVal = sortSelect ? sortSelect.value : '';
      var visibleProducts = 0;

      productRows.forEach(function (row) {
        var searchBlob = [
          row.getAttribute('data-name'),
          row.getAttribute('data-description'),
          row.getAttribute('data-category')
        ].join(' ');
        var price = parseFloat(row.getAttribute('data-price')) || 0;
        var stock = parseInt(row.getAttribute('data-stock'), 10) || 0;
        var rowCat = normalize(row.getAttribute('data-category'));
        var matchesSearch = !search || searchBlob.indexOf(search) !== -1;
        var matchesMinPrice = minPrice == null || price >= minPrice;
        var matchesMaxPrice = maxPrice == null || price <= maxPrice;
        var matchesStock = !onlyInStock || stock > 0;
        var matchesCat = !categoryFilter || rowCat === categoryFilter;
        var visible = matchesSearch && matchesMinPrice && matchesMaxPrice && matchesStock && matchesCat;

        row.hidden = !visible;
        if (visible) visibleProducts++;
      });

      // Sort visible rows within each category block
      if (sortVal) {
        categoryBlocks.forEach(function(block) {
          var tbody = block.querySelector('tbody');
          if (!tbody) return;
          var visRows = Array.prototype.slice.call(tbody.querySelectorAll('[data-product-row]:not([hidden])'));
          visRows.sort(function(a, b) {
            if (sortVal === 'price-asc')  return parseFloat(a.getAttribute('data-price')) - parseFloat(b.getAttribute('data-price'));
            if (sortVal === 'price-desc') return parseFloat(b.getAttribute('data-price')) - parseFloat(a.getAttribute('data-price'));
            if (sortVal === 'name-asc')   return a.getAttribute('data-name').localeCompare(b.getAttribute('data-name'));
            return 0;
          });
          visRows.forEach(function(r) { tbody.appendChild(r); });
        });
      }

      categoryBlocks.forEach(function (block) {
        var visibleRows = block.querySelectorAll('[data-product-row]:not([hidden])').length;
        block.hidden = visibleRows === 0;
      });

      if (summaryEl) {
        if (visibleProducts === totalProducts) {
          summaryEl.innerHTML = 'Showing all <strong>' + totalProducts + '</strong> products.';
        } else {
          summaryEl.innerHTML = 'Showing <strong>' + visibleProducts + '</strong> of <strong>' + totalProducts + '</strong> products.';
        }
      }

      if (emptyEl) {
        emptyEl.hidden = visibleProducts !== 0;
      }

      // URL state persistence
      try {
        var params = new URLSearchParams();
        if (searchInput && searchInput.value) params.set('q', searchInput.value);
        if (minPriceInput && minPriceInput.value) params.set('min', minPriceInput.value);
        if (maxPriceInput && maxPriceInput.value) params.set('max', maxPriceInput.value);
        if (inStockInput && inStockInput.checked) params.set('stock', '1');
        if (categorySelect && categorySelect.value) params.set('cat', categorySelect.value);
        if (sortSelect && sortSelect.value) params.set('sort', sortSelect.value);
        var qs = params.toString();
        var newUrl = window.location.pathname + (qs ? '?' + qs : '');
        window.history.replaceState(null, '', newUrl);
      } catch (e) { /* ignore */ }
    }

    // Restore filter state from URL
    (function() {
      try {
        var params = new URLSearchParams(window.location.search);
        if (params.get('q') && searchInput) searchInput.value = params.get('q');
        if (params.get('min') && minPriceInput) minPriceInput.value = params.get('min');
        if (params.get('max') && maxPriceInput) maxPriceInput.value = params.get('max');
        if (params.get('stock') === '1' && inStockInput) inStockInput.checked = true;
        if (params.get('cat') && categorySelect) categorySelect.value = params.get('cat');
        if (params.get('sort') && sortSelect) sortSelect.value = params.get('sort');
      } catch (e) { /* ignore */ }
    })();

    // Debounce helper
    function debounce(fn, delay) {
      var timer;
      return function() {
        clearTimeout(timer);
        timer = setTimeout(fn, delay);
      };
    }

    var debouncedFilter = debounce(applyCatalogFilters, 200);

    if (searchInput) searchInput.addEventListener('input', debouncedFilter);
    if (minPriceInput) minPriceInput.addEventListener('input', debouncedFilter);
    if (maxPriceInput) maxPriceInput.addEventListener('input', debouncedFilter);
    if (inStockInput) inStockInput.addEventListener('change', applyCatalogFilters);
    if (categorySelect) categorySelect.addEventListener('change', applyCatalogFilters);
    if (sortSelect) sortSelect.addEventListener('change', applyCatalogFilters);

    function clearFilters() {
      if (filterForm) filterForm.reset();
      applyCatalogFilters();
    }
    if (clearFiltersBtn) clearFiltersBtn.addEventListener('click', clearFilters);
    if (clearEmptyBtn) clearEmptyBtn.addEventListener('click', clearFilters);

    applyCatalogFilters();
  }

  // --- Category Collapse ---
  document.querySelectorAll('[data-category-toggle]').forEach(function(title) {
    var key = 'cat-collapsed-' + title.getAttribute('data-category-toggle');
    var block = title.closest('[data-category-block]');
    if (!block) return;

    if (sessionStorage.getItem(key) === '1') {
      block.classList.add('is-collapsed');
    }

    title.addEventListener('click', function() {
      block.classList.toggle('is-collapsed');
      sessionStorage.setItem(key, block.classList.contains('is-collapsed') ? '1' : '0');
    });
  });

  // --- Buy Modal ---
  var modal = document.getElementById('buyModal');
  if (modal) {
    var form = document.getElementById('buyForm');
    var elProduct = document.getElementById('m-product');
    var elProductId = document.getElementById('m-product-id');
    var elQty = document.getElementById('m-qty');
    var elUnit = document.getElementById('m-unit');
    var elTotal = document.getElementById('m-total');
    var elManualId = document.getElementById('m-manual-id');
    var elMinHint = document.getElementById('m-min-hint');
    var elTgError = document.getElementById('m-tg-error');

    var current = { price: 0, stock: 1, min: 1, productName: '' };
    var selectedPayMethod = null;
    var selectedPayLabel = '';

    function recalc() {
      var q = parseInt(elQty.value, 10) || current.min;
      if (q < current.min) q = current.min;
      if (q > current.stock) q = current.stock;
      elQty.value = q;
      if (elUnit) elUnit.textContent = fmt(current.price);
      if (elTotal) elTotal.textContent = fmt(current.price * q);
      updateOrderSummary();
    }

    function updateOrderSummary() {
      var osc = document.getElementById('orderSummaryConfirm');
      if (!osc || !selectedPayMethod) return;
      var q = parseInt(elQty.value, 10) || 1;
      var p = document.getElementById('osc-product');
      var qEl = document.getElementById('osc-qty');
      var mEl = document.getElementById('osc-method');
      var tEl = document.getElementById('osc-total');
      if (p) p.textContent = current.productName;
      if (qEl) qEl.textContent = q;
      if (mEl) mEl.textContent = selectedPayLabel;
      if (tEl) tEl.textContent = fmt(current.price * q);
      osc.style.display = '';
      var confirmBtn = document.getElementById('confirmOrderBtn');
      if (confirmBtn) confirmBtn.style.display = '';
    }

    function openModal(btn) {
      current.price = parseFloat(btn.getAttribute('data-price')) || 0;
      current.stock = parseInt(btn.getAttribute('data-stock'), 10) || 1;
      current.min = parseInt(btn.getAttribute('data-min'), 10) || 1;
      current.productName = btn.getAttribute('data-name') || '';
      if (elProduct) elProduct.textContent = current.productName;
      if (elProductId) elProductId.value = btn.getAttribute('data-id');
      if (elQty) {
        elQty.value = current.min;
        elQty.min = current.min;
        elQty.max = current.stock;
      }
      if (elMinHint) {
        elMinHint.textContent = current.min > 1 ? '(min: ' + current.min + ')' : '';
      }
      // Reset selection
      selectedPayMethod = null;
      selectedPayLabel = '';
      form.querySelectorAll('.pay-method-btn').forEach(function(b) { b.classList.remove('is-selected'); });
      var osc = document.getElementById('orderSummaryConfirm');
      if (osc) osc.style.display = 'none';
      var confirmBtn = document.getElementById('confirmOrderBtn');
      if (confirmBtn) confirmBtn.style.display = 'none';

      recalc();
      modal.classList.add('is-open');
      document.body.style.overflow = 'hidden';
    }

    function closeModal() {
      modal.classList.remove('is-open');
      document.body.style.overflow = '';
    }

    document.querySelectorAll('.btn-buy').forEach(function (btn) {
      btn.addEventListener('click', function () { openModal(btn); });
    });

    document.getElementById('modalClose').addEventListener('click', closeModal);
    modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && modal.classList.contains('is-open')) closeModal(); });

    if (elQty) elQty.addEventListener('input', recalc);

    var elPaymentType = document.getElementById('m-payment-type');
    var elTelegram = document.getElementById('m-telegram');

    // Telegram validation helper
    function validateTg() {
      if (!elTelegram) return true;
      var val = elTelegram.value.replace(/^@/, '').trim();
      elTelegram.value = val ? ('@' + val) : '';
      if (!val) {
        if (elTgError) { elTgError.textContent = 'Telegram username is required.'; elTgError.style.display = ''; }
        elTelegram.focus();
        return false;
      }
      if (/\s/.test(val)) {
        if (elTgError) { elTgError.textContent = 'Username cannot contain spaces.'; elTgError.style.display = ''; }
        elTelegram.focus();
        return false;
      }
      if (elTgError) elTgError.style.display = 'none';
      return true;
    }

    if (elTelegram) {
      elTelegram.addEventListener('input', function() {
        if (elTgError) elTgError.style.display = 'none';
      });
      elTelegram.addEventListener('blur', function() {
        // Auto-strip @ on blur to normalise
        var val = elTelegram.value.replace(/^@+/, '').trim();
        if (val) elTelegram.value = val;
      });
    }

    // Payment method buttons — show confirm card, then submit
    form.querySelectorAll('.pay-method-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!validateTg()) return;
        var pay = btn.getAttribute('data-pay');
        var manual = btn.getAttribute('data-manual') || '';
        if (elPaymentType) elPaymentType.value = pay;
        if (elManualId) elManualId.value = manual;

        // Show selected state
        form.querySelectorAll('.pay-method-btn').forEach(function(b) { b.classList.remove('is-selected'); });
        btn.classList.add('is-selected');

        // Capture label for summary
        var strong = btn.querySelector('strong');
        selectedPayMethod = pay;
        selectedPayLabel = strong ? strong.textContent : pay;

        updateOrderSummary();

        // Scroll confirm button into view
        var confirmBtn = document.getElementById('confirmOrderBtn');
        if (confirmBtn) {
          setTimeout(function() { confirmBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 100);
        }
      });
    });

    // Confirm button submits form
    var confirmBtn = document.getElementById('confirmOrderBtn');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', function() {
        if (!validateTg()) return;
        if (!selectedPayMethod) return;
        // Strip @ before submit
        if (elTelegram) {
          elTelegram.value = elTelegram.value.replace(/^@/, '').trim();
        }
        if (form.requestSubmit) {
          form.requestSubmit();
        } else {
          form.submit();
        }
      });
    }
  }

  // --- Payment Method Tabs ---
  var tabBar = document.getElementById('payTabBar');
  if (tabBar) {
    var tabs = Array.prototype.slice.call(tabBar.querySelectorAll('.pay-tab'));
    tabs.forEach(function(tab) {
      tab.addEventListener('click', function() {
        var targetPanel = tab.getAttribute('data-tab');
        tabs.forEach(function(t) { t.classList.remove('is-active'); });
        tab.classList.add('is-active');
        document.querySelectorAll('[data-tab-panel]').forEach(function(panel) {
          panel.classList.toggle('is-active', panel.getAttribute('data-tab-panel') === targetPanel);
        });
      });
    });
  }

  // --- Mobile Menu Toggle with Backdrop ---
  var menuToggle = document.getElementById('menuToggle');
  var mainNav = document.getElementById('mainNav');
  var navBackdrop = document.getElementById('navBackdrop');

  function closeNav() {
    if (mainNav) mainNav.classList.remove('is-open');
    if (navBackdrop) navBackdrop.classList.remove('is-open');
    document.body.style.overflow = '';
  }
  function openNav() {
    if (mainNav) mainNav.classList.add('is-open');
    if (navBackdrop) navBackdrop.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }

  if (menuToggle && mainNav) {
    menuToggle.addEventListener('click', function (e) {
      e.stopPropagation();
      if (mainNav.classList.contains('is-open')) {
        closeNav();
      } else {
        openNav();
      }
    });

    if (navBackdrop) {
      navBackdrop.addEventListener('click', closeNav);
    }

    document.addEventListener('click', function (e) {
      if (mainNav.classList.contains('is-open') && !mainNav.contains(e.target) && e.target !== menuToggle) {
        closeNav();
      }
    });
  }
})();

