(() => {
  'use strict';

  const target = () => document.getElementById('published-customer-reviews');
  const showFailure = error => {
    console.error('Published customer reviews could not render:', error);
    const node = target();
    if (!node) return;
    node.replaceChildren();
    const message = document.createElement('p');
    message.className = 'review-loading review-status-error';
    message.setAttribute('role', 'status');
    message.textContent = 'Customer reviews could not be displayed right now.';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'button button-secondary';
    retry.textContent = 'Try loading reviews again';
    retry.addEventListener('click', load);
    node.append(message, retry);
  };

  async function load() {
    const node = target();
    if (!node || node.dataset.loading === 'true') return;
    node.dataset.loading = 'true';
    try {
      const response = await fetch('/api/customer-reviews', { headers: { Accept: 'application/json' }, cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `Review request failed (${response.status}).`);
      if (!Array.isArray(payload.reviews)) throw new Error('The review service returned an invalid response.');
      node.replaceChildren();
      const oldCount = node.parentElement.querySelector('.landing-review-count');
      oldCount?.remove();
      const reviews = payload.reviews.filter(review => typeof review.review_text === 'string' && typeof review.customer_name === 'string' && typeof review.business_name === 'string' && Number(review.rating) >= 1 && Number(review.rating) <= 5);
      if (!reviews.length) {
        const empty = document.createElement('p');
        empty.className = 'review-loading';
        empty.textContent = 'Be the first to share your experience.';
        node.append(empty);
        return;
      }
      reviews.forEach(review => {
        const card = document.createElement('article');
        card.className = 'landing-review-card';
        const stars = document.createElement('span');
        stars.className = 'landing-review-stars';
        stars.setAttribute('aria-label', `${Number(review.rating)} out of 5 stars`);
        stars.textContent = '★'.repeat(Number(review.rating));
        const quote = document.createElement('blockquote');
        quote.textContent = `“${review.review_text}”`;
        const author = document.createElement('p');
        author.className = 'review-author';
        author.textContent = `${review.customer_name} · ${review.business_name}`;
        card.append(stars, quote, author);
        node.append(card);
      });
      const count = document.createElement('p');
      count.className = 'landing-review-count';
      count.textContent = `${reviews.length} real customer review${reviews.length === 1 ? '' : 's'}`;
      node.before(count);
    } catch (error) {
      showFailure(error);
    } finally {
      node.dataset.loading = 'false';
    }
  }

  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const status = document.getElementById('customer-review-status');
    const button = document.getElementById('customer-review-submit');
    status.textContent = '';
    button.disabled = true;
    button.textContent = 'Submitting…';
    try {
      const response = await fetch('/api/customer-reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(form)))
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Review could not be submitted.');
      status.textContent = payload.message || 'Thank you for sharing your experience.';
      form.reset();
      await load();
    } catch (error) {
      status.textContent = error.message || 'Could not submit your review. Please try again later.';
    } finally {
      button.disabled = false;
      button.textContent = 'Submit review';
    }
  }

  document.getElementById('customer-review-form')?.addEventListener('submit', submit);
  window.loadPublishedCustomerReviews = load;
  load();
})();
