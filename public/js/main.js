(function () {
  'use strict';

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
      // Fallback if timezone not supported in very old browsers
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

  window.money = fmt;
  window.currencyCode = currencyCode;

  var filterForm = document.getElementById('catalogFilters');
  if (filterForm) {
    var searchInput = document.getElementById('catalogSearch');
    var minPriceInput = document.getElementById('catalogMinPrice');
    var maxPriceInput = document.getElementById('catalogMaxPrice');
    var inStockInput = document.getElementById('catalogInStock');
    var clearFiltersBtn = document.getElementById('catalogFilterClear');
    var summaryEl = document.getElementById('catalogFilterSummary');
    var emptyEl = document.getElementById('catalogFilterEmpty');
    var categoryBlocks = Array.prototype.slice.call(document.querySelectorAll('[data-category-block]'));
    var productRows = Array.prototype.slice.call(document.querySelectorAll('[data-product-row]'));
    var totalProducts = productRows.length;

    function normalize(value) {
      return String(value || '').toLowerCase().trim();
    }

    function applyCatalogFilters() {
      var search = normalize(searchInput.value);
      var minPrice = minPriceInput.value === '' ? null : parseFloat(minPriceInput.value);
      var maxPrice = maxPriceInput.value === '' ? null : parseFloat(maxPriceInput.value);
      var onlyInStock = !!inStockInput.checked;
      var visibleProducts = 0;

      productRows.forEach(function (row) {
        var searchBlob = [
          row.getAttribute('data-name'),
          row.getAttribute('data-description'),
          row.getAttribute('data-category')
        ].join(' ');
        var price = parseFloat(row.getAttribute('data-price')) || 0;
        var stock = parseInt(row.getAttribute('data-stock'), 10) || 0;
        var matchesSearch = !search || searchBlob.indexOf(search) !== -1;
        var matchesMinPrice = minPrice == null || price >= minPrice;
        var matchesMaxPrice = maxPrice == null || price <= maxPrice;
        var matchesStock = !onlyInStock || stock > 0;
        var visible = matchesSearch && matchesMinPrice && matchesMaxPrice && matchesStock;

        row.hidden = !visible;
        if (visible) visibleProducts++;
      });

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
    }

    [searchInput, minPriceInput, maxPriceInput].forEach(function (input) {
      if (!input) return;
      input.addEventListener('input', applyCatalogFilters);
    });
    if (inStockInput) inStockInput.addEventListener('change', applyCatalogFilters);
    if (clearFiltersBtn) {
      clearFiltersBtn.addEventListener('click', function () {
        filterForm.reset();
        applyCatalogFilters();
      });
    }

    applyCatalogFilters();
  }

  var modal = document.getElementById('buyModal');
  if (modal) {
    var form = document.getElementById('buyForm');
    var elProduct = document.getElementById('m-product');
    var elProductId = document.getElementById('m-product-id');
    var elQty = document.getElementById('m-qty');
    var elUnit = document.getElementById('m-unit');
    var elTotal = document.getElementById('m-total');
    var elManualId = document.getElementById('m-manual-id');
    var elSimType = document.getElementById('m-sim-type');
    var elDeliveryAddress = document.getElementById('m-delivery-address');
    var simTypeSection = document.getElementById('simTypeSection');
    var deliveryAddressSection = document.getElementById('deliveryAddressSection');

    var current = { price: 0, stock: 1, min: 1 };

    function recalc() {
      var q = parseInt(elQty.value, 10) || current.min;
      if (q < current.min) q = current.min;
      if (q > current.stock) q = current.stock;
      elQty.value = q;
      elUnit.textContent = fmt(current.price);
      elTotal.textContent = fmt(current.price * q);
    }

    function openModal(btn) {
      current.price = parseFloat(btn.getAttribute('data-price')) || 0;
      current.stock = parseInt(btn.getAttribute('data-stock'), 10) || 1;
      current.min = parseInt(btn.getAttribute('data-min'), 10) || 1;
      
      // Get rental data
      const isRentable = parseInt(btn.getAttribute('data-is-rentable')) || 0;
      const rental1d = parseFloat(btn.getAttribute('data-rental-1d')) || 0;
      const rental7d = parseFloat(btn.getAttribute('data-rental-7d')) || 0;
      const rental30d = parseFloat(btn.getAttribute('data-rental-30d')) || 0;
      
      elProduct.textContent = btn.getAttribute('data-name');
      elProductId.value = btn.getAttribute('data-id');
      elQty.value = current.min;
      elQty.min = current.min;
      elQty.max = current.stock;
      recalc();
      
      // Call the rental-aware modal function
      if (window.showBuyModal) {
        window.showBuyModal(
          btn.getAttribute('data-id'),
          btn.getAttribute('data-name'),
          current.price,
          current.stock,
          current.min,
          rental1d,
          rental7d,
          rental30d,
          isRentable
        );
      }
      // Reset SIM type and delivery address fields
      if (elSimType) {
        elSimType.value = '';
        elSimType.required = false;
      }
      if (elDeliveryAddress) {
        elDeliveryAddress.value = '';
        elDeliveryAddress.required = false;
      }
      
      // Show/hide SIM type section based on product category
      // For now, show it for all products - admin will leave empty if not applicable
      if (simTypeSection) {
        simTypeSection.style.display = 'block';
        if (elSimType) {
          elSimType.required = true;
        }
      }
      if (deliveryAddressSection) {
        deliveryAddressSection.style.display = 'none';
      }
      
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
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !modal.hidden) closeModal(); });

    elQty.addEventListener('input', recalc);

    // Handle SIM type change - show/hide delivery address
    if (elSimType) {
      elSimType.addEventListener('change', function () {
        if (this.value === 'SIM') {
          if (deliveryAddressSection) deliveryAddressSection.style.display = 'block';
          if (elDeliveryAddress) {
            elDeliveryAddress.required = true;
            elDeliveryAddress.focus();
          }
        } else {
          if (deliveryAddressSection) deliveryAddressSection.style.display = 'none';
          if (elDeliveryAddress) {
            elDeliveryAddress.required = false;
            elDeliveryAddress.value = '';
          }
        }
      });
    }

    var elPaymentType = document.getElementById('m-payment-type');
    var elTelegram = document.getElementById('m-telegram');

    // Payment method buttons — set hidden fields then submit the form.
    form.querySelectorAll('.pay-method-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tg = elTelegram ? elTelegram.value.trim() : '';
        if (!tg) {
          if (elTelegram) {
            elTelegram.focus();
            elTelegram.setCustomValidity('Please enter your Telegram username.');
            elTelegram.reportValidity();
            elTelegram.setCustomValidity('');
          }
          return;
        }
        
        // Validate SIM type if required
        if (elSimType && elSimType.required && !elSimType.value) {
          elSimType.focus();
          elSimType.setCustomValidity('Please select a SIM type.');
          elSimType.reportValidity();
          elSimType.setCustomValidity('');
          return;
        }
        
        // Validate delivery address if SIM type is 'SIM'
        if (elSimType && elSimType.value === 'SIM' && elDeliveryAddress) {
          var address = elDeliveryAddress.value.trim();
          if (!address) {
            elDeliveryAddress.focus();
            elDeliveryAddress.setCustomValidity('Please enter your delivery address.');
            elDeliveryAddress.reportValidity();
            elDeliveryAddress.setCustomValidity('');
            return;
          }
        }
        
        var pay = btn.getAttribute('data-pay');
        var manual = btn.getAttribute('data-manual') || '';
        if (elPaymentType) elPaymentType.value = pay;
        if (elManualId) elManualId.value = manual;
        if (form.requestSubmit) {
          form.requestSubmit();
        } else {
          form.submit();
        }
      });
    });

    // Clear telegram validation on input.
    if (elTelegram) {
      elTelegram.addEventListener('input', function () {
        elTelegram.setCustomValidity('');
      });
    }
  }

  // --- Mobile Menu Toggle ---
  var menuToggle = document.getElementById('menuToggle');
  var mainNav = document.getElementById('mainNav');
  if (menuToggle && mainNav) {
    menuToggle.addEventListener('click', function (e) {
      e.stopPropagation();
      mainNav.classList.toggle('is-open');
    });

    document.addEventListener('click', function (e) {
      if (!mainNav.contains(e.target) && e.target !== menuToggle) {
        mainNav.classList.remove('is-open');
      }
    });
  }
})();
