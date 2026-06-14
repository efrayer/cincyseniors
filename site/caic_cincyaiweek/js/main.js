/* ============================================
   CAIC Cincinnati AI Week — Main JavaScript
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {

  // --- Announcement banner offset for nav ---
  const announcement = document.querySelector('.announcement');
  if (announcement) {
    document.body.classList.add('has-announcement');
    const mobileNav = document.querySelector('.nav-mobile');
    const navEl = document.querySelector('.nav');
    const updateMobileNavTop = () => {
      if (mobileNav && navEl) {
        mobileNav.style.top = (navEl.offsetTop + navEl.offsetHeight) + 'px';
      }
    };
    updateMobileNavTop();
    window.addEventListener('resize', updateMobileNavTop);
  }

  // --- Navigation scroll effect ---
  const nav = document.querySelector('.nav');
  if (nav) {
    const onScroll = () => {
      nav.classList.toggle('scrolled', window.scrollY > 20);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // --- Mobile menu toggle ---
  const hamburger = document.querySelector('.nav-hamburger');
  const mobileMenu = document.querySelector('.nav-mobile');
  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', () => {
      hamburger.classList.toggle('open');
      mobileMenu.classList.toggle('open');
    });
    mobileMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        hamburger.classList.remove('open');
        mobileMenu.classList.remove('open');
      });
    });
  }

  // --- Dropdown nav items ---
  document.querySelectorAll('.nav-dropdown').forEach(dropdown => {
    const toggle = dropdown.querySelector('.nav-dropdown-toggle');
    if (toggle) {
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('open');
      });
    }
  });

  document.addEventListener('click', () => {
    document.querySelectorAll('.nav-dropdown.open').forEach(d => d.classList.remove('open'));
  });

  // --- Active nav link ---
  const currentPage = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-primary-links a, .nav-secondary-links a, .nav-mobile a').forEach(link => {
    const href = link.getAttribute('href');
    if (href === currentPage || (currentPage === '' && href === 'index.html')) {
      link.classList.add('active');
    }
  });

  // --- Tabs ---
  document.querySelectorAll('.tabs').forEach(tabContainer => {
    const buttons = tabContainer.querySelectorAll('.tab-btn');
    const panels = document.querySelectorAll('.tab-panel');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        buttons.forEach(b => b.classList.remove('active'));
        panels.forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const target = document.querySelector(`#${btn.dataset.tab}`);
        if (target) target.classList.add('active');
      });
    });
  });

  // --- Newsletter form ---
  document.querySelectorAll('.newsletter-form').forEach(form => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = form.querySelector('input[type="email"]');
      const btn = form.querySelector('button');
      if (input && input.value) {
        btn.textContent = 'Subscribed!';
        btn.disabled = true;
        input.value = '';
        setTimeout(() => {
          btn.textContent = 'Subscribe';
          btn.disabled = false;
        }, 3000);
      }
    });
  });

  // --- Smooth scroll for anchor links ---
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
      const target = document.querySelector(anchor.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // --- Intersection observer for fade-in animations ---
  const animatedEls = document.querySelectorAll(
    '.card, .team-card, .blog-card, .person-card, .event-card, .link-card, .ff-card, .schedule-session'
  );
  if ('IntersectionObserver' in window && animatedEls.length) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.style.opacity = '1';
          entry.target.style.transform = 'translateY(0)';
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

    animatedEls.forEach((el, i) => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(20px)';
      el.style.transition = `opacity 0.5s ease ${i * 0.04}s, transform 0.5s ease ${i * 0.04}s, border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease`;
      observer.observe(el);
    });
  }

  // --- Node graphic parallax (subtle) ---
  const nodes = document.querySelectorAll('.hero-node');
  if (nodes.length) {
    window.addEventListener('mousemove', (e) => {
      const x = (e.clientX / window.innerWidth - 0.5) * 20;
      const y = (e.clientY / window.innerHeight - 0.5) * 20;
      nodes.forEach((node, i) => {
        const factor = (i + 1) * 0.3;
        node.style.transform = `translate(${x * factor}px, ${y * factor}px)`;
      });
    }, { passive: true });
  }

});
