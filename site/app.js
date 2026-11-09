import {
  backupVersion, calculateRecipe, diaryCsv, findFoods, makeEntry, meals, nutrients, nutrientKeys,
  parseQuantity, prettyDay, shiftDay, summarize, today, validateBackup, validateCatalog, weeklyReview,
} from './core.js';
import { loadDiary, openDiary, updateDiary } from './storage.js';

const $ = id => document.getElementById(id);
const dialog = $('modal');
const modal = $('modal-body');
const tabs = ['diary', 'foods', 'review', 'settings'];
const numberFormat = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const format = number => numberFormat.format(number);
const size = (number, unit) => `${format(number)} ${unit}`;
const nutrient = (key, amount) => amount == null ? 'Unknown' : size(amount, nutrients[key][1]);
const primary = nutrientKeys.slice(0, 5);
const sourceTypes = ['Package label', 'Restaurant nutrition label', 'Restaurant estimate', 'Personal estimate'];
const presets = ['Whey protein', 'ON Serious Mass', 'ON Creatine', 'BCAA', 'MIILD Protein Roti', 'Zomato order'];
let db, state, catalog, day = today(), foodLimit = 24, alertTimer;

function element(tag, options = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, options);
  node.append(...children);
  return node;
}

function button(label, action, className = 'quiet') {
  return element('button', { type: 'button', textContent: label, className, onclick: action });
}

function message(text, error = false) {
  clearTimeout(alertTimer);
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
  $('status').hidden = false;
  if (!error) alertTimer = setTimeout(() => { $('status').hidden = true; }, 4000);
}

async function save(update, success, after) {
  try {
    state = await updateDiary(db, update);
    render();
    if (success) message(success);
    after?.();
    return true;
  } catch (error) {
    const target = modal.querySelector('.form-error');
    if (dialog.open && target) target.textContent = error.message;
    else message(error.message || 'Could not save your changes.', true);
    return false;
  }
}

function showDialog(title, content) {
  $('modal-title').textContent = title;
  modal.replaceChildren(content);
  if (!dialog.open) dialog.showModal();
  modal.querySelector('input:not([type=hidden]), select')?.focus();
}

function formError(form, text) {
  form.querySelector('.form-error').textContent = text;
}

function allFoods() {
  return [...state.foods, ...catalog];
}

function search(query) {
  const recents = [...new Set(state.entries.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(entry => entry.foodId))].slice(0, 40);
  return findFoods(allFoods(), query, state.favorites, recents);
}

function sourceInfo(source) {
  const label = source.url
    ? element('a', { href: source.url, target: '_blank', rel: 'noopener noreferrer', textContent: source.label })
    : source.label;
  return element('p', { className: 'muted' }, label, source.note ? ` · ${source.note}` : '');
}

function nutrientGrid(keys, valueFor) {
  return element('div', { className: 'details-grid' }, ...keys.map(key =>
    element('div', {}, nutrients[key][0], element('strong', { textContent: valueFor(key) }))));
}

function foodRow(food, action, label) {
  const context = [nutrient('kcal', food.nutrients.kcal) + ` / 100 ${food.basis}`, food.source.label];
  if (state.favorites.includes(food.id)) context.unshift('Favorite');
  return element('div', { className: 'food-row' },
    element('div', { className: 'row-main' }, element('strong', { textContent: food.name }),
      element('small', { textContent: context.join(' · ') })),
    button(label, () => action(food)));
}

function renderDiary() {
  $('day').value = day;
  $('complete').checked = state.completed[day] === true;
  const entries = state.entries.filter(entry => entry.day === day);
  const total = summarize(entries);
  const display = key => entries.length ? nutrient(key, total[key].value) : '—';
  const coverage = key => total[key].known > 0 && total[key].known < total[key].total
    ? `Partial · ${total[key].known}/${total[key].total} items` : '';
  $('summary').replaceChildren(...primary.map(key => {
    const target = state.settings[key];
    return element('div', { className: 'stat' }, element('span', { textContent: nutrients[key][0] }),
      element('strong', { textContent: display(key) }),
      element('small', { textContent: coverage(key) || (target ? `Goal ${nutrient(key, target)}` : '') }));
  }));
  $('extra-nutrients').replaceChildren(nutrientGrid(nutrientKeys.slice(5), key => [display(key), coverage(key)].filter(Boolean).join(' · ')));
  $('meals').replaceChildren(...meals.map(meal => {
    const list = entries.filter(entry => entry.meal === meal);
    const header = element('div', { className: 'meal-head' }, element('div', {},
      element('h3', { textContent: meal }), element('small', { className: 'muted', textContent: list.length
        ? nutrient('kcal', summarize(list).kcal.value) : 'Ready when you are' })),
      button('+ Add food', () => addFood(meal), ''));
    const rows = list.map(entry => element('div', { className: 'entry' },
      element('div', { className: 'row-main' }, element('strong', { textContent: entry.name }),
        element('small', { textContent: `${size(entry.quantity, entry.unit)} · ${nutrient('kcal', entry.nutrients.kcal)}` })),
      button('Edit', () => editEntry(entry))));
    const footer = element('div', { className: 'actions' });
    if (list.length) footer.append(button('Save this meal', () => saveMeal(meal, list)));
    if (state.savedMeals.length) footer.append(button('Repeat saved meal', () => repeatMeal(meal)));
    return element('article', { className: 'panel meal' }, header,
      ...(rows.length ? rows : [element('p', { className: 'empty', textContent: 'Nothing logged here yet.' })]), footer);
  }));
}

function renderFoods() {
  const results = search($('catalog-query').value);
  $('catalog-count').textContent = `${results.length} matching foods · ${allFoods().length} in your catalog`;
  $('catalog-list').replaceChildren(...results.slice(0, foodLimit).map(food => foodRow(food, inspectFood, 'View')));
  $('more-foods').hidden = results.length <= foodLimit;
  $('saved-meals').replaceChildren(...state.savedMeals.map(item => element('div', { className: 'food-row' },
    element('div', { className: 'row-main' }, element('strong', { textContent: item.name }),
      element('small', { textContent: item.entries.map(entry => entry.name).join(', ') })),
    button('Remove', () => confirmAction('Remove saved meal', `Remove “${item.name}” from saved meals?`, 'Remove',
      () => save(draft => { draft.savedMeals = draft.savedMeals.filter(meal => meal.id !== item.id); }, 'Saved meal removed.'))))));
  if (!state.savedMeals.length) $('saved-meals').append(element('p', { className: 'empty', textContent: 'Your saved meals will appear here.' }));
}

function renderReview() {
  const review = weeklyReview(state, day);
  $('review-range').textContent = `${prettyDay(review.start)} – ${prettyDay(review.end)} · ${review.complete} complete days of ${review.logged} logged`;
  const cards = [];
  const card = (heading, text) => element('article', { className: 'panel' },
    element('h2', { textContent: heading }), element('p', { className: 'muted', textContent: text }));
  if (review.complete < 2) {
    cards.push(card('Build your weekly picture', 'Mark at least two logged days complete in the diary to see patterns. The review uses the seven days ending on the date selected in the diary.'));
  } else {
    const metrics = ['kcal', 'protein', 'fiber'].map(key => {
      const metric = review[key];
      return metric.count >= 2
        ? `${nutrients[key][0]} averaged ${nutrient(key, metric.value)} across ${metric.count} fully covered days.`
        : `${nutrients[key][0]} needs more complete nutrient data.`;
    });
    cards.push(card('Daily averages', metrics.join(' ')));
    if (state.settings.kcal && review.kcal.count >= 2) {
      const target = nutrient('kcal', state.settings.kcal);
      const exact = review.kcal.count - review.aboveCalories - review.belowCalories;
      cards.push(card('Calorie target', `Against your ${target} target, ${review.aboveCalories} days were above, ${review.belowCalories} below and ${exact} matched. ${review.kcal.count} complete days had calorie data. If the difference surprises you, review the saved portions and recipe estimates in those entries.`));
    }
    if (state.settings.protein && review.protein.count >= 2) {
      const comparison = `Protein was below your ${nutrient('protein', state.settings.protein)} target on ${review.belowProtein} of ${review.protein.count} fully covered days.`;
      if (review.belowProtein >= 2) {
        const foods = state.settings.diet === 'vegan' ? 'cooked chana, rajma or tofu'
          : state.settings.diet === 'vegetarian' ? 'dal, plain curd or paneer' : 'dal, eggs or chicken';
        const observed = review.meal ? ` ${review.meal.meal} averaged ${nutrient('protein', review.meal.average)} on ${review.meal.count} of those days when it was logged.` : '';
        const action = ` Try previewing a portion of ${foods} ${review.meal ? `at ${review.meal.meal.toLowerCase()}` : 'with a usual meal'}.`;
        cards.push(card('Protein pattern', comparison + observed + action));
      } else cards.push(card('Protein pattern', comparison));
    } else if (!state.settings.protein) {
      cards.push(card('Protein target', 'You can add your own daily protein target in Settings to see how it compares with complete diary days.'));
    }
    if (!review.categories.includes('Fruit') || !review.categories.includes('Vegetables')) {
      const group = !review.categories.includes('Fruit') && !review.categories.includes('Vegetables')
        ? 'fruit or vegetable' : review.categories.includes('Fruit') ? 'vegetable' : 'fruit';
      cards.push(card('Food variety', `No separate ${group} entries appeared on the ${review.complete} complete days. If you ate some in a mixed dish, it may already be part of that entry. Otherwise try adding a ${group} you enjoy to a usual meal.`));
    }
  }
  $('review-content').replaceChildren(...cards);
}

function renderSettings() {
  const fields = $('settings-form').elements;
  for (const key of ['kcal', 'protein', 'diet']) fields[key].value = state.settings[key] ?? '';
  $('last-backup').textContent = state.settings.lastBackup
    ? `Last backup export requested ${new Date(state.settings.lastBackup).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`
    : 'No backup exported yet.';
}

function render() {
  const current = tabs.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'diary';
  for (const tab of tabs) {
    $(tab).hidden = tab !== current;
    const link = document.querySelector(`nav a[href="#${tab}"]`);
    if (tab === current) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if (current === 'diary') renderDiary();
  if (current === 'foods') renderFoods();
  if (current === 'review') renderReview();
  if (current === 'settings') renderSettings();
}

function addFood(meal) {
  const query = element('input', { id: 'add-query', type: 'search', placeholder: 'Try rajma, dahi or chicken' });
  const results = element('div', { className: 'results' });
  const hint = element('p', { className: 'muted' });
  const update = () => {
    const list = search(query.value);
    hint.textContent = list.length ? `Showing ${Math.min(35, list.length)} of ${list.length} matches`
      : 'No match. Add a custom food from your label or recipe.';
    results.replaceChildren(...list.slice(0, 35).map(food => foodRow(food, selected => choosePortion(selected, meal), 'Select')));
  };
  query.oninput = update;
  const actions = element('div', { className: 'actions' },
    button('+ Custom food', () => customFood(meal), 'secondary'),
    button('Supplement or restaurant label', () => quickLabel(meal), 'secondary'));
  if (state.savedMeals.length) actions.append(button('Repeat saved meal', () => repeatMeal(meal)));
  showDialog(`Add to ${meal.toLowerCase()}`, element('div', { className: 'stack' },
    element('label', { htmlFor: query.id, textContent: 'Search food' }), query, hint, results, actions));
  update();
}

function inspectFood(food) {
  const favorite = state.favorites.includes(food.id);
  const panel = element('div', { className: 'stack' },
    sourceInfo(food.source), element('p', { className: 'tag', textContent: `Nutrition per 100 ${food.basis}` }),
    nutrientGrid(nutrientKeys, key => nutrient(key, food.nutrients[key])));
  if (food.recipe?.length) {
    const parts = food.recipe.map(item => {
      const ingredient = allFoods().find(candidate => candidate.id === item.id);
      return `${ingredient?.name || item.id} · ${size(item.amount, ingredient?.basis || 'g')}`;
    });
    panel.append(element('p', { className: 'muted', textContent: `Batch ingredients: ${parts.join(', ')}` }));
  }
  const meal = element('select', {}, ...meals.map(value => element('option', { value, textContent: value })));
  const actions = element('div', { className: 'actions' }, button('Log food', () => choosePortion(food, meal.value), ''),
    button(favorite ? 'Unfavorite' : 'Favorite', async () => {
      if (await save(draft => {
        draft.favorites = favorite ? draft.favorites.filter(id => id !== food.id) : [...new Set([...draft.favorites, food.id])];
      })) inspectFood(food);
    }));
  panel.append(element('label', {}, `Log on ${prettyDay(day)}`, meal), actions);
  if (food.recipe?.length) actions.append(button('Adapt recipe', () => recipeForm(food), 'secondary'));
  if (food.id.startsWith('custom-') && !food.recipe?.length) actions.append(button('Edit food', () => customFood(null, food), 'secondary'));
  showDialog(food.name, panel);
}

function portionForm({ food, meal, oldEntry }) {
  const custom = state.portions.filter(item => item.foodId === food.id);
  const options = [{ label: food.basis, amount: 1 }, ...(food.portions || []), ...custom];
  if (oldEntry && !options.some(item => item.label === oldEntry.unit && item.amount === oldEntry.factor)) {
    options.push({ label: oldEntry.unit, amount: oldEntry.factor });
  }
  const initial = oldEntry ? options.findIndex(item => item.label === oldEntry.unit && item.amount === oldEntry.factor)
    : custom.length ? options.length - 1 : options.length > 1 ? 1 : 0;
  const amount = element('input', { id: 'portion-amount', value: String(oldEntry?.quantity ?? (initial ? 1 : 100)), required: true });
  const unit = element('select', { id: 'portion-unit' }, ...options.map((option, index) => element('option', {
    value: String(index), textContent: index && !/\d\s*(?:mL|g)\b/i.test(option.label)
      ? `${option.label} (${size(option.amount, food.basis)})` : option.label,
  })));
  unit.value = String(initial);
  const mealSelect = element('select', {}, ...meals.map(value => element('option', { value, textContent: value })));
  mealSelect.value = meal;
  const preview = element('div', { className: 'portion-preview', ariaLive: 'polite' });
  const form = element('form', { className: 'stack' });
  const error = element('p', { className: 'form-error', role: 'alert' });
  const details = element('details', {}, element('summary', { textContent: 'All nutrients for this portion' }));
  const calculate = () => {
    const quantity = parseQuantity(amount.value);
    if (!quantity) return null;
    const selected = options[Number(unit.value)];
    if (quantity * selected.amount > 1e7) return null;
    return makeEntry(food, quantity, selected.label, selected.amount, mealSelect.value, oldEntry?.day || day);
  };
  const update = () => {
    const result = calculate();
    preview.textContent = result ? `${size(result.quantity * result.factor, result.basis)} · ${nutrient('kcal', result.nutrients.kcal)} · ${nutrient('protein', result.nutrients.protein)} protein` : 'Enter a positive amount, such as 1.5 or 1/2.';
    details.querySelector('.details-grid')?.remove();
    if (result) details.append(nutrientGrid(nutrientKeys, key => nutrient(key, result.nutrients[key])));
  };
  amount.oninput = update;
  unit.onchange = update;
  const actions = element('div', { className: 'actions' }, element('button', {
    type: 'submit', textContent: oldEntry ? 'Save entry' : 'Log food',
  }), button('+ Personal portion', () => personalPortion(food, meal, oldEntry), 'secondary'));
  if (oldEntry) actions.append(button('Delete entry', () => confirmAction('Delete diary entry',
    `Remove “${oldEntry.name}” from ${oldEntry.meal.toLowerCase()}?`, 'Delete', () => save(draft => {
      draft.entries = draft.entries.filter(item => item.id !== oldEntry.id);
      delete draft.completed[oldEntry.day];
    }, 'Entry deleted. Mark the day complete again when ready.')), 'danger'));
  else actions.append(button('Back to search', () => addFood(meal)));
  form.append(sourceInfo(food.source), element('div', { className: 'fields' },
    element('label', {}, 'Quantity', amount), element('label', {}, 'Unit', unit)),
  element('label', {}, 'Meal', mealSelect), preview, details, error, actions);
  form.onsubmit = async event => {
    event.preventDefault();
    const result = calculate();
    if (!result) return formError(form, 'Enter a valid portion.');
    await save(draft => {
      if (oldEntry) {
        if (!draft.entries.some(item => item.id === oldEntry.id)) throw new Error('This entry was removed in another tab.');
        draft.entries = draft.entries.map(item => item.id === oldEntry.id
          ? { ...result, id: item.id, createdAt: item.createdAt } : item);
      } else draft.entries.push(result);
      delete draft.completed[result.day];
    }, oldEntry ? 'Entry updated.' : `Added ${result.name} to ${result.meal.toLowerCase()}.`, () => dialog.close());
  };
  showDialog(food.name, form);
  update();
}

function choosePortion(food, meal) {
  portionForm({ food, meal });
}

function editEntry(entry) {
  const factor = 100 / (entry.quantity * entry.factor);
  const currentFood = allFoods().find(item => item.id === entry.foodId);
  const food = { ...currentFood, id: entry.foodId, name: entry.name, basis: entry.basis,
    category: entry.category, source: entry.source, nutrients: Object.fromEntries(Object.entries(entry.nutrients)
      .map(([key, amount]) => [key, amount * factor])) };
  portionForm({ food, meal: entry.meal, oldEntry: entry });
}

function personalPortion(food, meal, oldEntry) {
  const form = element('form', { className: 'stack' });
  const label = element('input', { required: true, maxLength: 50, placeholder: 'My katori' });
  const amount = element('input', { type: 'number', min: '0.01', max: '100000', step: 'any', required: true });
  form.append(element('label', {}, 'Portion name', label), element('label', {}, `Amount in ${food.basis}`, amount),
    element('p', { className: 'form-error', role: 'alert' }), element('button', { type: 'submit', textContent: 'Save portion' }));
  form.onsubmit = async event => {
    event.preventDefault();
    if (!label.value.trim()) return formError(form, 'Enter a portion name.');
    await save(draft => {
      draft.portions = draft.portions.filter(item => !(item.foodId === food.id && item.label.toLowerCase() === label.value.trim().toLowerCase()));
      draft.portions.push({ id: crypto.randomUUID(), foodId: food.id, label: label.value.trim(), amount: amount.valueAsNumber });
    }, 'Personal portion saved.', () => portionForm({ food, meal, oldEntry }));
  };
  showDialog(`Personal portion for ${food.name}`, form);
}

function quickLabel(meal) {
  showDialog('Add a label or restaurant order', element('div', { className: 'stack' },
    element('p', { className: 'muted', textContent: 'Enter the figures from your exact product or menu. Save it once to reuse it later. For a restaurant meal with no label, choose a similar catalog dish or save a clearly marked estimate.' }),
    element('div', { className: 'actions' }, ...presets.map(name =>
      button(name, () => customFood(meal, null, name), 'secondary')))));
}

function customFood(meal, existing, preset = '') {
  const form = element('form', { className: 'stack' });
  const input = (properties = {}) => element('input', properties);
  const name = input({ required: true, maxLength: 100, value: existing?.name || (preset === 'Zomato order' ? '' : preset),
    placeholder: preset === 'Zomato order' ? 'Restaurant and dish name' : 'Brand, food and variant' });
  const kind = element('select', {}, ...sourceTypes.map(value => element('option', { value, textContent: value })));
  kind.value = existing?.source.label || (preset === 'Zomato order' ? sourceTypes[1] : sourceTypes[0]);
  const category = element('select', {}, ...[...new Set(['Custom food', 'Supplements', 'Restaurant meal', 'Fruit', 'Vegetables',
    ...catalog.map(food => food.category)])].map(value => element('option', { value, textContent: value })));
  category.value = existing?.category || (preset === 'Zomato order' ? 'Restaurant meal' : preset && preset !== 'MIILD Protein Roti' ? 'Supplements' : 'Custom food');
  const basis = element('select', {}, ...['g', 'ml'].map(value => element('option', { value, textContent: value })));
  basis.value = existing?.basis || 'g';
  if (existing) basis.disabled = true;
  const firstPortion = existing?.portions?.[0];
  const reference = input({ type: 'number', min: '0.001', max: '100000', step: 'any', required: true, value: String(firstPortion?.amount || 100) });
  const portionName = input({ maxLength: 50, placeholder: 'e.g. scoop or piece', value: firstPortion?.label || (preset === 'Zomato order' ? 'order' : '') });
  const note = input({ maxLength: 250, value: existing?.source.note || '', placeholder: 'Flavour, label date or estimate details' });
  const url = input({ type: 'url', maxLength: 500, value: existing?.source.url || '', placeholder: 'https://…' });
  const fields = Object.fromEntries(nutrientKeys.map(key => [key, input({
    type: 'number', min: '0', max: '100000', step: 'any', required: key === 'kcal',
    value: Number.isFinite(existing?.nutrients[key]) ? String(Math.round(existing.nutrients[key] * (firstPortion?.amount || 100) * 1000000 / 100) / 1000000) : '',
  })]));
  const grid = keys => element('div', { className: 'fields three' }, ...keys.map(key =>
    element('label', {}, `${nutrients[key][0]} (${nutrients[key][1]})`, fields[key])));
  form.append(element('label', {}, 'Food name', name),
    element('div', { className: 'fields' }, element('label', {}, 'Source type', kind), element('label', {}, 'Food group', category)),
    element('div', { className: 'fields three' }, element('label', {}, 'Label amount', reference),
      element('label', {}, 'Unit', basis), element('label', {}, 'Portion name', portionName)),
    element('p', { className: 'muted', textContent: 'Enter nutrients for the label amount above. For a scoop or package serving, use its stated weight or volume. Leave unlisted nutrients blank.' }),
    grid(primary), element('details', {}, element('summary', { textContent: 'More nutrient fields' }), grid(nutrientKeys.slice(5))),
    element('label', {}, 'Source notes (optional)', note), element('label', {}, 'Source link (optional)', url),
    element('p', { className: 'form-error', role: 'alert' }), element('button', { type: 'submit', textContent: 'Save food' }));
  form.onsubmit = async event => {
    event.preventDefault();
    if (!name.value.trim()) return formError(form, 'Enter a food name.');
    if (url.value && !/^https?:\/\//i.test(url.value)) return formError(form, 'Enter an https or http source link.');
    const factor = 100 / reference.valueAsNumber;
    const food = { id: existing?.id || `custom-${crypto.randomUUID()}`, name: name.value.trim(),
      category: category.value, basis: basis.value,
      nutrients: Object.fromEntries(nutrientKeys.filter(key => fields[key].value !== '')
        .map(key => [key, fields[key].valueAsNumber * factor])),
      portions: portionName.value.trim() ? [{ label: portionName.value.trim(), amount: reference.valueAsNumber }] : [],
      source: { label: kind.value, ...(note.value.trim() ? { note: note.value.trim() } : {}), ...(url.value ? { url: url.value } : {}) } };
    try { validateCatalog([food]); } catch (error) { return formError(form, error.message); }
    await save(draft => {
      draft.foods = [...draft.foods.filter(item => item.id !== food.id), food];
    }, 'Food saved.', () => meal ? choosePortion(food, meal) : inspectFood(food));
  };
  showDialog(existing ? 'Edit custom food' : 'Save a custom food', form);
}

function recipeForm(template) {
  const form = element('form', { className: 'stack' });
  const rows = element('div');
  const available = allFoods().slice().sort((a, b) => a.name.localeCompare(b.name));
  const ingredients = new Map(available.map(food => [food.id, food]));
  const recipeName = element('input', { required: true, maxLength: 100, value: template ? `My ${template.name}` : '' });
  const cooked = element('input', { type: 'number', min: '0.01', max: '100000', step: 'any', placeholder: 'Best for accuracy' });
  const servings = element('input', { type: 'number', min: '0.01', max: '10000', step: 'any', placeholder: 'Optional with weight' });
  const group = element('select', {}, ...['Indian dishes', 'Vegetables', 'Fruit', 'Custom food'].map(value => element('option', { value, textContent: value })));
  const addRow = (ingredient = {}) => {
    const select = element('select', { required: true },
      element('option', { value: '', textContent: 'Select food' }),
      ...available.map(food => element('option', { value: food.id, textContent: food.name })));
    select.value = ingredients.has(ingredient.id) ? ingredient.id : '';
    const quantity = element('input', { required: true, value: ingredient.amount ? String(ingredient.amount) : '' });
    const unit = element('span');
    const update = () => { unit.textContent = `Amount (${ingredients.get(select.value)?.basis || 'g or ml'})`; };
    select.onchange = update;
    update();
    const row = element('div', { className: 'recipe-row' }, element('label', {}, 'Ingredient', select),
      element('label', {}, unit, quantity), button('Remove', () => row.remove()));
    rows.append(row);
  };
  for (const ingredient of template?.recipe || [{}]) addRow(ingredient);
  form.append(element('label', {}, 'Recipe name', recipeName), element('label', {}, 'Food group', group), rows,
    button('+ Add ingredient', () => addRow(), 'secondary'),
    element('div', { className: 'fields' }, element('label', {}, 'Cooked batch weight (g)', cooked), element('label', {}, 'Servings in batch', servings)),
    element('p', { className: 'muted', textContent: 'Include the oil, ghee and sugar you use. For a serving-only batch with ingredients weighed in grams, the app estimates weight from their sum. Enter cooked weight for recipes with ingredients measured in millilitres.' }),
    element('p', { className: 'form-error', role: 'alert' }), element('button', { type: 'submit', textContent: 'Save recipe' }));
  form.onsubmit = async event => {
    event.preventDefault();
    const items = [...rows.children].map(row => ({
      food: ingredients.get(row.querySelector('select').value), amount: parseQuantity(row.querySelector('input').value),
    }));
    const name = recipeName.value.trim();
    const weight = cooked.valueAsNumber;
    const count = servings.valueAsNumber;
    if (!name || !items.length || items.some(item => !item.food || !item.amount)) return formError(form, 'Enter a name and a valid amount for every ingredient.');
    if (!weight && (!count || items.some(item => item.food.basis !== 'g'))) {
      return formError(form, 'Enter the cooked weight, or servings for a recipe with ingredients weighed in grams.');
    }
    const yieldWeight = weight || items.reduce((sum, item) => sum + item.amount, 0);
    const food = { id: `recipe-${crypto.randomUUID()}`, name, category: group.value, basis: 'g',
      nutrients: calculateRecipe(items, yieldWeight),
      portions: count ? [{ label: 'serving', amount: yieldWeight / count }] : [],
      source: { label: 'Homemade recipe estimate',
        note: weight ? `Calculated from your ingredients and ${size(weight, 'g')} cooked yield.`
          : `Calculated per serving. Weight uses the ${size(yieldWeight, 'g')} sum of ingredients as an estimate.` },
      recipe: items.map(item => ({ id: item.food.id, amount: item.amount })) };
    try { validateCatalog([food]); } catch (error) { return formError(form, error.message); }
    await save(draft => { draft.foods.push(food); }, 'Recipe saved.', () => inspectFood(food));
  };
  showDialog(template ? 'Adapt this recipe' : 'Build a recipe', form);
}

function saveMeal(meal, entries) {
  const form = element('form', { className: 'stack' });
  const name = element('input', { maxLength: 80, required: true, placeholder: 'e.g. Usual lunch' });
  form.append(element('label', {}, 'Saved meal name', name),
    element('p', { className: 'muted', textContent: entries.map(entry => entry.name).join(' · ') }),
    element('p', { className: 'form-error', role: 'alert' }),
    element('button', { type: 'submit', textContent: 'Save meal' }));
  form.onsubmit = async event => {
    event.preventDefault();
    if (!name.value.trim()) return formError(form, 'Enter a meal name.');
    await save(draft => {
      draft.savedMeals.push({ id: crypto.randomUUID(), name: name.value.trim(), entries });
    }, `${meal} saved to your library.`, () => dialog.close());
  };
  showDialog('Save this meal', form);
}

function repeatMeal(meal) {
  const list = element('div', { className: 'stack' }, element('p', { className: 'muted', textContent: `Add all portions to ${meal.toLowerCase()} on ${prettyDay(day)}.` }));
  const selectedDay = day;
  for (const item of state.savedMeals) {
    list.append(element('div', { className: 'food-row' }, element('strong', { className: 'row-main', textContent: item.name }),
      button('Add meal', () => save(draft => {
        const current = draft.savedMeals.find(candidate => candidate.id === item.id);
        if (!current) throw new Error('This saved meal was removed in another tab.');
        const createdAt = new Date().toISOString();
        draft.entries.push(...current.entries.map(entry => ({ ...entry, id: crypto.randomUUID(), day: selectedDay, meal, createdAt })));
        delete draft.completed[selectedDay];
      }, `Added ${item.name} to ${meal.toLowerCase()}.`, () => dialog.close()), '')));
  }
  showDialog('Repeat a saved meal', list);
}

function confirmAction(title, description, label, action) {
  const confirm = button(label, async () => {
    confirm.disabled = true;
    if (await action()) dialog.close();
    else confirm.disabled = false;
  }, 'danger');
  showDialog(title, element('div', { className: 'stack' }, element('p', { textContent: description }),
    element('p', { className: 'form-error', role: 'alert' }),
    element('div', { className: 'actions' }, confirm, button('Cancel', () => dialog.close()))));
}

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = element('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function readJson(input) {
  const file = input.files[0];
  input.value = '';
  if (!file) return undefined;
  if (file.size > 25 * 1024 * 1024) throw new Error('Choose a JSON file smaller than 25 MB.');
  try { return JSON.parse(await file.text()); } catch { throw new Error('The file is not readable JSON.'); }
}

function goToDay(value) {
  day = value;
  renderDiary();
}

function bind() {
  $('close-modal').onclick = () => dialog.close();
  $('previous').onclick = () => goToDay(shiftDay(day, -1));
  $('next').onclick = () => goToDay(shiftDay(day, 1));
  $('today').onclick = () => goToDay(today());
  $('day').onchange = event => { if (event.target.validity.valid && event.target.value) goToDay(event.target.value); };
  $('complete').onchange = async event => {
    const checked = event.target.checked;
    const target = day;
    if (!await save(draft => {
      if (checked && !draft.entries.some(entry => entry.day === target)) throw new Error('Log a meal before marking this day complete.');
      if (checked) draft.completed[target] = true;
      else delete draft.completed[target];
    })) renderDiary();
  };
  $('catalog-query').oninput = () => { foodLimit = 24; renderFoods(); };
  $('more-foods').onclick = () => { foodLimit += 24; renderFoods(); };
  $('new-food').onclick = () => customFood(null);
  $('new-recipe').onclick = () => recipeForm();
  $('settings-form').onsubmit = async event => {
    event.preventDefault();
    const fields = event.target.elements;
    const kcal = fields.kcal.valueAsNumber || null;
    const protein = fields.protein.valueAsNumber || null;
    const diet = fields.diet.value;
    await save(draft => { Object.assign(draft.settings, { kcal, protein, diet }); }, 'Targets saved.');
  };
  $('backup').onclick = async () => {
    const exportedAt = new Date().toISOString();
    await save(draft => { draft.settings.lastBackup = exportedAt; }, 'Backup export requested.', () =>
      download(`daily-katori-${today()}.json`, JSON.stringify({ version: backupVersion, exportedAt, data: state }, null, 2), 'application/json'));
  };
  $('csv').onclick = async () => {
    try {
      const latest = await loadDiary(db);
      download(`daily-katori-${today()}.csv`, '\uFEFF' + diaryCsv(latest.entries), 'text/csv;charset=utf-8');
    } catch { message('Could not export the diary.', true); }
  };
  $('restore').onclick = () => $('backup-file').click();
  $('backup-file').onchange = async event => {
    try {
      const json = await readJson(event.target);
      if (json === undefined) return;
      const restored = validateBackup(json);
      const reserved = new Set(catalog.map(food => food.id));
      if (restored.foods.some(food => reserved.has(food.id))) throw new Error('This backup contains a food ID reserved by the bundled catalog.');
      confirmAction('Restore this backup?', `This file contains ${restored.entries.length} entries, ${restored.foods.length} custom foods and ${restored.savedMeals.length} saved meals. Restoring replaces the current diary and settings on this device.`, 'Replace local diary',
        () => save(() => restored, 'Backup restored.'));
    } catch (error) { message(error.message, true); }
  };
  $('import-catalog').onclick = () => $('catalog-file').click();
  $('catalog-file').onchange = async event => {
    try {
      const json = await readJson(event.target);
      if (json === undefined) return;
      const imported = validateCatalog(json);
      const reserved = new Set(catalog.map(food => food.id));
      const conflicting = imported.find(food => reserved.has(food.id) || /^(?:custom|recipe)-/.test(food.id));
      if (conflicting) throw new Error(`“${conflicting.name}” uses a reserved food ID. Give it a unique personal ID.`);
      const ids = new Set(imported.map(food => food.id));
      confirmAction('Import these foods?', `${imported.length} foods will be added to your personal catalog. Matching personal food IDs will be updated. Past diary entries keep their saved values.`, 'Import foods',
        () => save(draft => { draft.foods = [...draft.foods.filter(food => !ids.has(food.id)), ...imported]; }, 'Personal foods imported.'));
    } catch (error) { message(error.message, true); }
  };
  $('sample-catalog').onclick = () => download('daily-katori-food-example.json', JSON.stringify([{
    id: 'personal-example', name: 'Example food (replace with your label)', category: 'Custom food', basis: 'g',
    aliases: ['example'], nutrients: { kcal: 100, protein: 4 }, portions: [{ label: 'serving', amount: 75 }],
    source: { label: 'Package label', note: 'Nutrients in this file are per 100 g.' },
  }], null, 2), 'application/json');
  window.addEventListener('hashchange', render);
  window.addEventListener('pageshow', async event => {
    if (event.persisted) {
      try { state = await loadDiary(db); render(); } catch { message('Could not refresh the local diary.', true); }
    }
  });
}

async function init() {
  try {
    const [database, response] = await Promise.all([openDiary(), fetch('./catalog.json')]);
    if (!response.ok) throw new Error('The food catalog could not load.');
    db = database;
    catalog = validateCatalog(await response.json());
    state = await loadDiary(db);
    bind();
    render();
  } catch (error) {
    message(`Daily Katori could not start. ${error.message} Reload and check that browser storage is available.`, true);
    return;
  }
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./sw.js');
      const timeout = setTimeout(() => {
        $('offline-status').textContent = 'Offline setup is taking longer than expected. Reload while online to retry.';
      }, 15000);
      await navigator.serviceWorker.ready;
      clearTimeout(timeout);
      $('offline-status').textContent = 'Ready offline on this browser.';
    } catch {
      $('offline-status').textContent = 'Offline setup could not finish. Reload while online to try again.';
    }
  } else $('offline-status').textContent = 'Offline installation needs a browser with service worker support.';
}

init();
