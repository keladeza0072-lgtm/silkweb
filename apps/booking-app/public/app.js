/* Booking UI. All appointment math stays in UTC; displayed times are UTC. */
'use strict';

const barberEl = document.getElementById('barber');
const serviceEl = document.getElementById('service');
const dateEl = document.getElementById('date');
const slotsEl = document.getElementById('slots');
const bookEl = document.getElementById('book');
const formMessageEl = document.getElementById('form-message');
const confirmationEl = document.getElementById('confirmation');
const confirmationTextEl = document.getElementById('confirmation-text');
const bookingsEl = document.getElementById('bookings');
const bookingsMessageEl = document.getElementById('bookings-message');

let selectedSlot = null;
let staffById = new Map();
let servicesById = new Map();

function utcDateKey(d) {
  return d.toISOString().slice(0, 10);
}

function nextSevenUtcDates() {
  const now = new Date();
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const out = [];
  for (let i = 0; i < 7; i += 1) out.push(utcDateKey(new Date(base + i * 86400000)));
  return out;
}

function slotLabel(startTime) {
  // startTime is canonical UTC: YYYY-MM-DDTHH:mm:00.000Z
  return startTime.slice(11, 16) + ' UTC';
}

function setMessage(el, text, kind) {
  el.textContent = text;
  el.className = 'message' + (kind ? ' ' + kind : '');
}

async function readError(res, fallback) {
  try {
    const body = await res.json();
    if (body && body.error && body.error.message) return body.error.message;
  } catch (_) {
    // fall through to the fallback message
  }
  return fallback;
}

async function loadCatalog() {
  const [staffRes, serviceRes] = await Promise.all([fetch('/api/staff'), fetch('/api/services')]);
  if (!staffRes.ok || !serviceRes.ok) throw new Error('Could not load staff/services.');
  const staff = (await staffRes.json()).staff;
  const services = (await serviceRes.json()).services;
  staffById = new Map(staff.map((s) => [s.id, s.name]));
  servicesById = new Map(services.map((s) => [s.id, s.name]));
  barberEl.innerHTML = staff.map((s) => `<option value="${s.id}"></option>`).join('');
  staff.forEach((s, i) => { barberEl.options[i].textContent = s.name; });
  serviceEl.innerHTML = services.map((s) => `<option value="${s.id}"></option>`).join('');
  services.forEach((s, i) => { serviceEl.options[i].textContent = `${s.name} (${s.duration_minutes} min)`; });
  dateEl.innerHTML = nextSevenUtcDates().map((d) => `<option value="${d}">${d}</option>`).join('');
}

async function loadAvailability() {
  selectedSlot = null;
  bookEl.disabled = true;
  const staffId = barberEl.value;
  const date = dateEl.value;
  if (!staffId || !date) {
    slotsEl.innerHTML = '';
    return;
  }
  const res = await fetch(`/api/availability?staffId=${encodeURIComponent(staffId)}&date=${encodeURIComponent(date)}`);
  if (!res.ok) {
    slotsEl.innerHTML = '';
    setMessage(formMessageEl, await readError(res, 'Could not load availability.'), 'error');
    return;
  }
  const { slots } = await res.json();
  setMessage(formMessageEl, '', '');
  slotsEl.innerHTML = '';
  for (const slot of slots) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'slot';
    btn.textContent = slotLabel(slot.startTime);
    btn.disabled = slot.booked || slot.past;
    if (slot.booked) btn.title = 'Already booked';
    else if (slot.past) btn.title = 'In the past (UTC)';
    else {
      btn.addEventListener('click', () => {
        selectedSlot = slot.startTime;
        slotsEl.querySelectorAll('.slot').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        bookEl.disabled = false;
        setMessage(formMessageEl, '', '');
      });
    }
    slotsEl.appendChild(btn);
  }
}

async function createBooking() {
  if (!selectedSlot) return;
  bookEl.disabled = true;
  const res = await fetch('/api/bookings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      staffId: Number(barberEl.value),
      serviceId: Number(serviceEl.value),
      startTime: selectedSlot,
    }),
  });
  if (!res.ok) {
    setMessage(formMessageEl, await readError(res, 'Booking failed.'), 'error');
    await loadAvailability(); // server state wins over cached availability
    await loadBookings();
    return;
  }
  const { booking } = await res.json();
  confirmationEl.hidden = false;
  confirmationTextEl.textContent =
    `${staffById.get(booking.staff_id)} — ${servicesById.get(booking.service_id)} on ${booking.start_time} (UTC, booking #${booking.id}).`;
  setMessage(formMessageEl, 'Booked. Pick another slot to add more appointments.', 'ok');
  await loadAvailability();
  await loadBookings();
}

async function loadBookings() {
  const res = await fetch('/api/bookings');
  if (!res.ok) {
    setMessage(bookingsMessageEl, await readError(res, 'Could not load bookings.'), 'error');
    return;
  }
  const { bookings } = await res.json();
  setMessage(bookingsMessageEl, '', '');
  bookingsEl.innerHTML = '';
  if (bookings.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No active bookings yet.';
    bookingsEl.appendChild(li);
    return;
  }
  for (const b of bookings) {
    const li = document.createElement('li');
    li.className = 'booking';
    const info = document.createElement('div');
    const when = document.createElement('div');
    when.className = 'when';
    when.textContent = `${b.start_time} (UTC)`;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${b.staff_name} — ${b.service_name} (#${b.id})`;
    info.append(when, meta);
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'cancel';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => cancelBooking(b.id));
    li.append(info, cancel);
    bookingsEl.appendChild(li);
  }
}

async function cancelBooking(id) {
  const res = await fetch(`/api/bookings/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    setMessage(bookingsMessageEl, await readError(res, 'Cancellation failed.'), 'error');
    return;
  }
  setMessage(bookingsMessageEl, `Booking #${id} cancelled; its slot is free again.`, 'ok');
  await loadAvailability();
  await loadBookings();
}

barberEl.addEventListener('change', loadAvailability);
dateEl.addEventListener('change', loadAvailability);
bookEl.addEventListener('click', createBooking);

(async function init() {
  try {
    await loadCatalog();
    await loadAvailability();
    await loadBookings();
  } catch (err) {
    setMessage(formMessageEl, err instanceof Error ? err.message : 'Startup failed.', 'error');
  }
})();
