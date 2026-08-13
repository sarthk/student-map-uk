(function () {
  "use strict";

  const MAX_ENERGY = 6;
  const STARTING_BUDGET = 45;

  const scenarios = [
    {
      id: "arrival",
      day: "Monday",
      place: "Arrival day",
      title: "From station to halls",
      text: "Your suitcase has one stubborn wheel and campus is just over a mile away. How are you getting there?",
      choices: [
        { title: "Walk with the welcome group", note: "Free, friendly and slightly uphill.", cost: 0, energy: -1, points: 5, tag: "explorer", outcome: "You learn the shortcut and three useful campus landmarks before check-in." },
        { title: "Take the local bus", note: "A quick first lesson in the city route.", cost: 2, energy: 0, points: 4, tag: "navigator", outcome: "You arrive on time and save the route for next week." },
        { title: "Grab a taxi", note: "Door to door, with room for the suitcase.", cost: 12, energy: 1, points: 1, tag: "comfort", outcome: "Very easy—although your weekly budget notices immediately." },
      ],
    },
    {
      id: "kitchen",
      day: "Monday",
      place: "Shared kitchen",
      title: "The first food shop",
      text: "Your shelf is empty apart from one heroic teabag. What goes in the basket?",
      choices: [
        { title: "Buy versatile basics", note: "Pasta, veg, oats and something spicy.", cost: 10, energy: 2, points: 6, tag: "cook", outcome: "Your shelf now has the ingredients for several actual meals." },
        { title: "Pick up ready meals", note: "Convenient, quick and fridge-friendly.", cost: 15, energy: 1, points: 3, tag: "quick", outcome: "Dinner is sorted, but the receipt is doing a little victory lap." },
        { title: "Plan meals before buying", note: "Check the cupboards, then make a list.", cost: 0, energy: -1, points: 4, tag: "planner", outcome: "You discover flatmates already brought enough rice for a small festival." },
      ],
    },
    {
      id: "books",
      day: "Tuesday",
      place: "Course induction",
      title: "The reading list lands",
      text: "The module guide names a very expensive core textbook. You need access by next week.",
      choices: [
        { title: "Reserve it at the library", note: "Free, but you make the trip today.", cost: 0, energy: -1, points: 6, tag: "library", outcome: "Reserved. You also find the quiet floor and a working printer." },
        { title: "Find a used copy", note: "A few notes in the margin may help.", cost: 8, energy: 0, points: 5, tag: "secondhand", outcome: "The previous owner highlighted the useful chapter. Excellent teamwork, indirectly." },
        { title: "Buy the newest edition", note: "Pristine pages and a serious price tag.", cost: 24, energy: 0, points: 2, tag: "newbook", outcome: "It smells impressively new. Your budget looks impressively smaller." },
      ],
    },
    {
      id: "society",
      day: "Wednesday",
      place: "Freshers fair",
      title: "An afternoon with options",
      text: "The sports hall is full of clubs, freebies and people explaining oddly specific hobbies.",
      choices: [
        { title: "Try a free society taster", note: "Meet a group and test something new.", cost: 0, energy: -1, points: 6, tag: "society", outcome: "You leave with a new hobby, a timetable and four mystery stickers." },
        { title: "Join a café meet-up", note: "A quieter chat over one drink.", cost: 4, energy: 0, points: 5, tag: "community", outcome: "You swap course tips and find someone else who also gets lost in the library." },
        { title: "Take a proper reset", note: "Back to halls, water bottle, early night.", cost: 0, energy: 2, points: 3, tag: "recharge", outcome: "You recharge without the fear of missing out. Tomorrow-you approves." },
      ],
    },
    {
      id: "lunch",
      day: "Thursday",
      place: "Between lectures",
      title: "The 40-minute lunch gap",
      text: "You are hungry, the next lecture is across campus and every queue has formed at once.",
      choices: [
        { title: "Heat yesterday’s batch-cook", note: "Fast, filling and already paid for.", cost: 3, energy: 2, points: 6, tag: "cook", outcome: "Lunch is ready before the microwave queue learns what happened." },
        { title: "Grab a meal deal", note: "Reliable and quick between buildings.", cost: 5, energy: 1, points: 4, tag: "quick", outcome: "A respectable sandwich-to-lecture transition with seconds to spare." },
        { title: "Order a delivery", note: "Maximum convenience, maximum receipt.", cost: 14, energy: 2, points: 1, tag: "comfort", outcome: "It arrives just as you need to leave. A dramatic lunch, financially and logistically." },
      ],
    },
    {
      id: "rain",
      day: "Friday",
      place: "Very British weather",
      title: "The sky changes its mind",
      text: "Sun at breakfast, sideways rain by noon. Your seminar starts in twenty minutes.",
      choices: [
        { title: "Walk under the covered route", note: "Free, longer and mostly dry.", cost: 0, energy: -1, points: 4, tag: "explorer", outcome: "You arrive with dry notes and a useful mental map of campus." },
        { title: "Hop on the bus", note: "Two stops and no puddle roulette.", cost: 2, energy: 0, points: 4, tag: "navigator", outcome: "You make it with time to find the room on the third attempt." },
        { title: "Buy a sturdy umbrella", note: "An investment for the next downpour.", cost: 8, energy: 0, points: 5, tag: "prepared", outcome: "Prepared for the rest of term—and suddenly popular at the bus stop." },
      ],
    },
    {
      id: "evening",
      day: "Sunday",
      place: "The week ahead",
      title: "One last Sunday decision",
      text: "Classes start properly tomorrow. You have one useful evening left before the alarm goes on.",
      choices: [
        { title: "Do a library power hour", note: "Set up notes, calendar and first reading.", cost: 0, energy: -1, points: 6, tag: "library", outcome: "Your Monday folder exists. This already feels suspiciously organised." },
        { title: "Plan the week with flatmates", note: "Share calendars and a simple dinner.", cost: 4, energy: 0, points: 5, tag: "community", outcome: "The bin rota is negotiated peacefully. Historians will study this moment." },
        { title: "Recharge and sleep early", note: "No heroics—just a full night’s rest.", cost: 0, energy: 2, points: 4, tag: "recharge", outcome: "Your alarm still feels rude, but considerably less rude." },
      ],
    },
  ];

  const elements = {
    startScreen: document.querySelector("#start-screen"),
    playScreen: document.querySelector("#play-screen"),
    endScreen: document.querySelector("#end-screen"),
    startButton: document.querySelector("#start-button"),
    restartButton: document.querySelector("#restart-button"),
    budget: document.querySelector("#budget-value"),
    energy: document.querySelector("#energy-value"),
    score: document.querySelector("#score-value"),
    progressLabel: document.querySelector("#progress-label"),
    progressPercent: document.querySelector("#progress-percent"),
    progressTrack: document.querySelector("#progress-track"),
    progressFill: document.querySelector("#progress-fill"),
    progressStops: document.querySelector("#progress-stops"),
    situationCard: document.querySelector("#situation-card"),
    situationPlace: document.querySelector("#situation-place"),
    situationDay: document.querySelector("#situation-day"),
    situationTitle: document.querySelector("#situation-title"),
    situationText: document.querySelector("#situation-text"),
    choiceList: document.querySelector("#choice-list"),
    feedback: document.querySelector("#feedback"),
    continueButton: document.querySelector("#continue-button"),
    resultTitle: document.querySelector("#result-title"),
    resultRank: document.querySelector("#result-rank"),
    finalScore: document.querySelector("#final-score-value"),
    bonusCopy: document.querySelector("#bonus-copy"),
    finalBudget: document.querySelector("#final-budget"),
    finalEnergy: document.querySelector("#final-energy"),
    finalMoves: document.querySelector("#final-moves"),
    achievements: document.querySelector("#achievement-list"),
  };

  let state;

  function freshState() {
    return {
      round: 0,
      budget: STARTING_BUDGET,
      energy: 4,
      score: 0,
      awaitingContinue: false,
      smartMoves: 0,
      tags: [],
    };
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function moneyEffect(cost) {
    return cost === 0 ? "Free" : `−£${cost}`;
  }

  function energyEffect(amount) {
    if (amount > 0) return `+${amount} energy`;
    if (amount < 0) return `${amount} energy`;
    return "Energy steady";
  }

  function effectsText(choice) {
    return `${moneyEffect(choice.cost)}, ${energyEffect(choice.energy)}, +${choice.points} Freshers Points`;
  }

  function updateStats() {
    elements.budget.textContent = `£${state.budget}`;
    elements.energy.textContent = `${state.energy} / ${MAX_ENERGY}`;
    elements.score.textContent = String(state.score);
  }

  function renderProgress() {
    const current = state.round + 1;
    const percentage = Math.round((current / scenarios.length) * 100);
    elements.progressLabel.textContent = `Stop ${current} of ${scenarios.length}`;
    elements.progressPercent.textContent = `${percentage}%`;
    elements.progressTrack.setAttribute("aria-valuenow", String(current));
    elements.progressFill.style.width = `${percentage}%`;
    elements.progressStops.innerHTML = scenarios.map((scenario, index) => {
      const className = index < state.round ? "is-complete" : index === state.round ? "is-current" : "";
      const currentAttribute = index === state.round ? ' aria-current="step"' : "";
      return `<li class="${className}"${currentAttribute}><span class="sr-only">${scenario.day}: ${scenario.title}${index < state.round ? ", complete" : index === state.round ? ", current" : ""}</span></li>`;
    }).join("");
  }

  function choiceMarkup(choice, index) {
    const unavailable = choice.cost > state.budget;
    const availability = unavailable ? ` You need £${choice.cost - state.budget} more.` : "";
    return `<button class="choice-button" type="button" data-choice="${index}" aria-keyshortcuts="${index + 1}" aria-disabled="${unavailable}" aria-label="Option ${index + 1}: ${choice.title}. ${effectsText(choice)}.${availability}">
      <span class="choice-key" aria-hidden="true">${index + 1}</span>
      <span class="choice-copy"><strong>${choice.title}</strong><small>${choice.note}${unavailable ? " · Not enough budget" : ""}</small></span>
      <span class="choice-effects" aria-hidden="true">
        <span class="effect ${choice.cost ? "effect-cost" : "effect-good"}">${moneyEffect(choice.cost)}</span>
        <span class="effect ${choice.energy > 0 ? "effect-good" : ""}">${energyEffect(choice.energy)}</span>
        <span class="effect effect-good">+${choice.points} pts</span>
      </span>
    </button>`;
  }

  function renderRound() {
    const scenario = scenarios[state.round];
    state.awaitingContinue = false;
    elements.situationPlace.textContent = scenario.place;
    elements.situationDay.textContent = scenario.day;
    elements.situationTitle.textContent = scenario.title;
    elements.situationText.textContent = scenario.text;
    elements.choiceList.innerHTML = scenario.choices.map(choiceMarkup).join("");
    elements.feedback.hidden = true;
    elements.feedback.classList.remove("is-warning");
    elements.continueButton.hidden = true;
    elements.situationCard.style.animation = "none";
    window.requestAnimationFrame(() => {
      elements.situationCard.style.animation = "";
    });

    elements.choiceList.querySelectorAll(".choice-button").forEach((button) => {
      button.addEventListener("click", () => choose(Number(button.dataset.choice)));
    });

    updateStats();
    renderProgress();
    elements.situationTitle.focus({ preventScroll: true });
  }

  function choose(index) {
    if (!state || state.awaitingContinue) return;
    const scenario = scenarios[state.round];
    const choice = scenario.choices[index];
    if (!choice) return;

    if (choice.cost > state.budget) {
      const shortfall = choice.cost - state.budget;
      elements.feedback.textContent = `That option needs £${shortfall} more than you have. Pick another route—there is always a free or affordable choice.`;
      elements.feedback.classList.add("is-warning");
      elements.feedback.hidden = false;
      return;
    }

    const energyBefore = state.energy;
    state.budget -= choice.cost;
    state.energy = clamp(state.energy + choice.energy, 0, MAX_ENERGY);
    state.score += choice.points;
    state.tags.push(choice.tag);
    if (choice.points >= 5 && choice.cost <= 10) state.smartMoves += 1;
    state.awaitingContinue = true;

    elements.choiceList.querySelectorAll(".choice-button").forEach((button, buttonIndex) => {
      button.disabled = true;
      button.classList.toggle("is-chosen", buttonIndex === index);
    });

    const energyChange = state.energy - energyBefore;
    const changeSummary = `${choice.cost ? `£${choice.cost} spent` : "nothing spent"}, ${energyChange === 0 ? "energy steady" : `${energyChange > 0 ? "+" : ""}${energyChange} energy`}, +${choice.points} points`;
    elements.feedback.textContent = `${choice.outcome} ${changeSummary}.`;
    elements.feedback.classList.remove("is-warning");
    elements.feedback.hidden = false;
    elements.continueButton.textContent = state.round === scenarios.length - 1 ? "See your Freshers result →" : "Continue to the next stop →";
    elements.continueButton.hidden = false;
    updateStats();
    elements.continueButton.focus({ preventScroll: false });
  }

  function continueGame() {
    if (!state || !state.awaitingContinue) return;
    if (state.round >= scenarios.length - 1) {
      finishGame();
      return;
    }
    state.round += 1;
    renderRound();
  }

  function scoreResult(finalScore) {
    if (finalScore >= 59) return { title: "Campus Navigator", copy: "You found the sweet spot between a sensible budget, useful shortcuts and enough energy for Monday." };
    if (finalScore >= 49) return { title: "Savvy Starter", copy: "A strong first week: practical choices, a healthy buffer and plenty learned along the route." };
    if (finalScore >= 38) return { title: "Freshers Finder", copy: "You made it through with stories, useful discoveries and a clearer map of student life." };
    return { title: "First-Week Finisher", copy: "Freshers Week is unpredictable, but you reached the end. A second run might uncover a thriftier route." };
  }

  function achievementMarkup() {
    const counts = state.tags.reduce((total, tag) => {
      total[tag] = (total[tag] || 0) + 1;
      return total;
    }, {});
    const achievements = [];
    if (counts.cook >= 2) achievements.push(["♨", "Batch-cook boss"]);
    if (counts.library >= 2) achievements.push(["▤", "Library legend"]);
    if (counts.community || counts.society) achievements.push(["◎", "Community starter"]);
    if (counts.navigator || counts.explorer) achievements.push(["⌖", "Campus navigator"]);
    if (counts.recharge) achievements.push(["⚡", "Recharge champion"]);
    if (state.budget >= 20) achievements.push(["£", "Budget buffer"]);
    if (!achievements.length) achievements.push(["✓", "Freshers finisher"]);
    return achievements.slice(0, 4).map(([icon, label]) => `<span class="achievement"><span aria-hidden="true">${icon}</span>${label}</span>`).join("");
  }

  function finishGame() {
    const budgetBonus = Math.floor(state.budget / 5);
    const energyBonus = state.energy * 2;
    const balanceBonus = state.budget >= 15 && state.energy >= 2 ? 5 : 0;
    const bonus = budgetBonus + energyBonus + balanceBonus;
    const finalScore = state.score + bonus;
    const result = scoreResult(finalScore);

    elements.playScreen.hidden = true;
    elements.endScreen.hidden = false;
    elements.finalScore.textContent = String(finalScore);
    elements.bonusCopy.textContent = `Includes ${bonus} balance bonus points`;
    elements.finalBudget.textContent = `£${state.budget}`;
    elements.finalEnergy.textContent = `${state.energy} / ${MAX_ENERGY}`;
    elements.finalMoves.textContent = String(state.smartMoves);
    elements.resultRank.innerHTML = `<strong>${result.title}</strong> — ${result.copy}`;
    elements.achievements.innerHTML = achievementMarkup();
    elements.resultTitle.focus({ preventScroll: false });
  }

  function startGame() {
    state = freshState();
    elements.startScreen.hidden = true;
    elements.endScreen.hidden = true;
    elements.playScreen.hidden = false;
    renderRound();
  }

  function focusAdjacentChoice(direction) {
    if (!state || state.awaitingContinue || elements.playScreen.hidden) return;
    const choices = [...elements.choiceList.querySelectorAll(".choice-button")];
    if (!choices.length) return;
    const currentIndex = choices.indexOf(document.activeElement);
    const nextIndex = currentIndex < 0 ? 0 : (currentIndex + direction + choices.length) % choices.length;
    choices[nextIndex].focus();
  }

  function onKeyDown(event) {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;

    if (!elements.playScreen.hidden && !state.awaitingContinue && /^[123]$/.test(event.key)) {
      event.preventDefault();
      const button = elements.choiceList.querySelector(`[data-choice="${Number(event.key) - 1}"]`);
      button?.click();
      return;
    }

    if (!elements.playScreen.hidden && !state.awaitingContinue && (event.key === "ArrowLeft" || event.key === "ArrowUp")) {
      event.preventDefault();
      focusAdjacentChoice(-1);
      return;
    }

    if (!elements.playScreen.hidden && !state.awaitingContinue && (event.key === "ArrowRight" || event.key === "ArrowDown")) {
      event.preventDefault();
      focusAdjacentChoice(1);
      return;
    }

    if (!elements.endScreen.hidden && event.key.toLowerCase() === "r") {
      event.preventDefault();
      startGame();
    }
  }

  elements.startButton.addEventListener("click", startGame);
  elements.restartButton.addEventListener("click", startGame);
  elements.continueButton.addEventListener("click", continueGame);
  document.addEventListener("keydown", onKeyDown);
}());
