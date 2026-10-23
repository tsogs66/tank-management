/* Stem line for the consumption plan.
   Order enough to finish the passage, hold the unpumpable, and keep a weather reserve.
   Quantity already entered under "to receive" reduces what is still to order. */
(function (root) {
  'use strict';

  function numOrZero(v) {
    if (v == null || v === '') return 0;
    const n = Number(v);
    return isNaN(n) ? 0 : n;
  }

  function advise(side, base) {
    const unpumpable = numOrZero(side && side.unpumpableMt);
    const weather = numOrZero(side && side.weatherMarginMt);
    const reserve = unpumpable + weather;
    const required = Number(base && base.required) || 0;
    const robRaw = base && base.rob;
    const rob = (robRaw == null || robRaw === '' || isNaN(Number(robRaw))) ? null : Number(robRaw);
    const receive = numOrZero(base && base.receive);
    if (rob == null) {
      return {
        unpumpable: unpumpable,
        weather: weather,
        reserve: reserve,
        orderMt: null,
        stemStill: null,
        arrivalMt: null,
        usableMt: null,
        receive: receive,
      };
    }
    const orderMt = Math.max(0, required + reserve - rob);
    const stemStill = Math.max(0, orderMt - receive);
    const taken = Math.max(receive, orderMt);
    const arrivalMt = rob + taken - required;
    const usableMt = arrivalMt - unpumpable;
    return {
      unpumpable: unpumpable,
      weather: weather,
      reserve: reserve,
      orderMt: orderMt,
      stemStill: stemStill,
      arrivalMt: arrivalMt,
      usableMt: usableMt,
      receive: receive,
    };
  }

  function sentence(grade, advice, fmt) {
    const g = grade || 'this grade';
    const mt = function (n) { return fmt ? fmt(n) : String(Math.round(n * 1000) / 1000); };
    if (!advice || advice.orderMt == null) return 'Enter current ROB to see what to order.';
    let text;
    if (advice.orderMt === 0 && advice.receive === 0) {
      text = 'No stem. You arrive with ' + mt(advice.arrivalMt) + ' MT ' + g + '.';
    } else {
      text = 'Order ' + mt(advice.orderMt) + ' MT ' + g + '. You arrive with ' + mt(advice.arrivalMt) + ' MT.';
    }
    if (advice.unpumpable > 0 || advice.weather > 0) {
      text += ' After ' + mt(advice.unpumpable) + ' MT unpumpable and ' + mt(advice.weather) + ' MT weather reserve, ' + mt(advice.usableMt) + ' MT remains usable.';
    }
    if (advice.receive > 0 && advice.stemStill > 0) {
      text += ' Quantity to receive is ' + mt(advice.receive) + ' MT, so order another ' + mt(advice.stemStill) + ' MT.';
    } else if (advice.receive > 0) {
      text += ' Quantity to receive covers this stem.';
    }
    return text;
  }

  const api = { advise: advise, sentence: sentence, numOrZero: numOrZero };
  root.StemAdvice = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
