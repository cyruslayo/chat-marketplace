"use strict";
(() => {
  // node_modules/@weaver/web/dist/basic/layout.js
  function applyBasicHook(element, component) {
    element.setAttribute("data-a2ui-component", component);
  }
  function mapJustify(value) {
    switch (value) {
      case "center":
        return "center";
      case "end":
        return "flex-end";
      case "spaceBetween":
        return "space-between";
      case "spaceAround":
        return "space-around";
      case "spaceEvenly":
        return "space-evenly";
      case "stretch":
        return "flex-start";
      case "start":
      default:
        return "flex-start";
    }
  }
  function mapAlign(value) {
    switch (value) {
      case "center":
        return "center";
      case "end":
        return "flex-end";
      case "start":
        return "flex-start";
      case "stretch":
      default:
        return "stretch";
    }
  }
  function relationshipChildren(relationships, property) {
    const relationship = relationships.find((candidate) => candidate.property === property);
    if (relationship === void 0)
      return [];
    return relationship.kind === "single" ? relationship.child === void 0 ? [] : [relationship.child] : relationship.children;
  }

  // node_modules/@weaver/web/dist/basic/markdown.js
  function appendText(document2, parent, text) {
    const lines = text.split("\n");
    lines.forEach((line, index) => {
      if (index > 0)
        parent.appendChild(document2.createElement("br"));
      if (line.length > 0)
        parent.appendChild(document2.createTextNode(line));
    });
  }
  function renderBasicInlineMarkdown(document2, text) {
    const output = document2.createDocumentFragment();
    let literal = "";
    let marker;
    let formatted = "";
    const flushLiteral = () => {
      appendText(document2, output, literal);
      literal = "";
    };
    const closeFormatting = () => {
      const element = document2.createElement(marker === "`" ? "code" : marker === "**" || marker === "__" ? "strong" : "em");
      appendText(document2, element, formatted);
      output.appendChild(element);
      marker = void 0;
      formatted = "";
    };
    for (let index = 0; index < text.length; ) {
      const target = marker === void 0 ? "literal" : "formatted";
      if (text[index] === "\\" && index + 1 < text.length && "*_`\\".includes(text[index + 1])) {
        if (target === "literal")
          literal += text[index + 1];
        else
          formatted += text[index + 1];
        index += 2;
        continue;
      }
      if (marker !== void 0) {
        if (text.startsWith(marker, index)) {
          const markerLength = marker.length;
          closeFormatting();
          index += markerLength;
        } else {
          formatted += text[index];
          index++;
        }
        continue;
      }
      const candidate = text.startsWith("**", index) ? "**" : text.startsWith("__", index) ? "__" : text[index] === "*" ? "*" : text[index] === "_" ? "_" : text[index] === "`" ? "`" : void 0;
      if (candidate === void 0) {
        literal += text[index];
        index++;
        continue;
      }
      flushLiteral();
      marker = candidate;
      index += candidate.length;
    }
    if (marker !== void 0)
      literal += marker + formatted;
    flushLiteral();
    return [...output.childNodes];
  }

  // node_modules/@weaver/web/dist/basic/styles.js
  var basicSpace = "var(--a2ui-space, 8px)";
  var basicRadius = "var(--a2ui-radius, 8px)";
  var basicOutline = "var(--a2ui-color-outline, rgba(0, 0, 0, 0.22))";
  var basicControl = "var(--a2ui-color-control, rgba(127, 127, 127, 0.10))";
  var basicCardShadow = "var(--a2ui-card-shadow, 0 1px 3px rgba(0, 0, 0, 0.12))";
  function appendBasicStyle(element, declarations) {
    const existing = element.getAttribute("style");
    element.setAttribute("style", `${existing === null || existing.trim() === "" ? "" : `${existing.trim().replace(/;?$/, ";")} `}${declarations}`);
  }
  function applyBasicMargin(element) {
    appendBasicStyle(element, `margin: ${basicSpace}`);
  }
  function applyControlShape(element) {
    appendBasicStyle(element, `border: 1px solid ${basicOutline}; border-radius: ${basicRadius}`);
  }

  // node_modules/@weaver/web/dist/basic/renderers.js
  var textElements = {
    h1: "h1",
    h2: "h2",
    h3: "h3",
    h4: "h4",
    h5: "h5",
    caption: "small",
    body: "p"
  };
  var renderText = ({ document: document2, properties }) => {
    const variant = typeof properties.variant === "string" && properties.variant in textElements ? properties.variant : "body";
    const element = document2.createElement(textElements[variant]);
    applyBasicHook(element, "Text");
    element.style.fontSize = variant === "body" ? "1em" : variant === "caption" ? "0.8em" : { h1: "2.5em", h2: "2em", h3: "1.75em", h4: "1.5em", h5: "1.25em" }[variant];
    element.style.fontWeight = variant === "body" || variant === "caption" ? "normal" : "700";
    if (variant === "caption")
      element.style.fontStyle = "italic";
    if (variant !== "body" && variant !== "caption")
      element.style.lineHeight = "1.2";
    applyBasicMargin(element);
    if (typeof properties.text === "string") {
      try {
        element.append(...renderBasicInlineMarkdown(document2, properties.text));
      } catch {
        element.textContent = properties.text;
      }
    }
    return element;
  };
  var renderDivider = ({ document: document2, properties }) => {
    if (properties.axis !== "vertical") {
      const element2 = document2.createElement("hr");
      applyBasicHook(element2, "Divider");
      element2.style.border = "0";
      element2.style.width = "auto";
      appendBasicStyle(element2, `border-block-start: 1px solid ${basicOutline}`);
      applyBasicMargin(element2);
      return element2;
    }
    const element = document2.createElement("div");
    applyBasicHook(element, "Divider");
    element.setAttribute("role", "separator");
    element.setAttribute("aria-orientation", "vertical");
    element.style.alignSelf = "stretch";
    element.style.minHeight = "1em";
    element.style.width = "0px";
    appendBasicStyle(element, `border-inline-start: 1px solid ${basicOutline}`);
    applyBasicMargin(element);
    return element;
  };
  function appendLayoutRelationshipChildren(parent, relationships, stretch) {
    const relationship = relationships.find((candidate) => candidate.property === "children");
    if (relationship === void 0)
      return;
    const apply = (node, weight) => {
      if (node.nodeType !== 1 || !("style" in node))
        return;
      const explicitWeight = typeof weight === "number" && Number.isFinite(weight) && weight >= 0;
      if (!explicitWeight && !stretch)
        return;
      node.style.flexGrow = String(explicitWeight ? weight : 1);
    };
    if (relationship.kind === "single") {
      if (relationship.child !== void 0) {
        apply(relationship.child, relationship.childProperties?.weight);
        parent.append(relationship.child);
      }
      return;
    }
    relationship.children.forEach((child, index) => {
      apply(child, relationship.childProperties?.[index]?.weight);
      parent.append(child);
    });
  }
  function renderLayout(direction, component) {
    return ({ document: document2, properties, relationships }) => {
      const element = document2.createElement("div");
      applyBasicHook(element, component);
      element.style.display = "flex";
      element.style.flexDirection = direction;
      const stretch = properties.justify === "stretch";
      element.style.justifyContent = stretch ? "flex-start" : mapJustify(properties.justify);
      element.style.alignItems = mapAlign(properties.align);
      appendLayoutRelationshipChildren(element, relationships, stretch);
      return element;
    };
  }
  var renderRow = renderLayout("row", "Row");
  var renderColumn = renderLayout("column", "Column");
  var renderList = ({ document: document2, properties, relationships }) => {
    const element = document2.createElement("div");
    applyBasicHook(element, "List");
    element.setAttribute("role", "list");
    element.style.display = "flex";
    const horizontal = properties.direction === "horizontal";
    element.style.flexDirection = horizontal ? "row" : "column";
    element.style.alignItems = mapAlign(properties.align);
    element.style.minHeight = "0";
    element.style.minWidth = "0";
    element.style.overflowX = horizontal ? "auto" : "hidden";
    element.style.overflowY = horizontal ? "hidden" : "auto";
    if (horizontal)
      element.style.flexWrap = "nowrap";
    for (const child of relationshipChildren(relationships, "children")) {
      const item = document2.createElement("div");
      item.setAttribute("role", "listitem");
      if (horizontal) {
        item.style.flexShrink = "0";
        item.style.maxWidth = "100%";
      }
      item.append(child);
      element.append(item);
    }
    return element;
  };
  var renderCard = ({ document: document2, relationships }) => {
    const element = document2.createElement("div");
    applyBasicHook(element, "Card");
    element.style.background = "transparent";
    element.style.padding = "16px";
    applyControlShape(element);
    appendBasicStyle(element, `box-shadow: ${basicCardShadow}`);
    applyBasicMargin(element);
    element.append(...relationshipChildren(relationships, "child"));
    return element;
  };
  function tabChildIndex(relationship) {
    const [tabs, index, child] = relationship.location;
    return relationship.kind === "single" && relationship.location.length === 3 && tabs?.kind === "property" && tabs.name === "tabs" && index?.kind === "arrayIndex" && child?.kind === "property" && child.name === "child" ? index.index : void 0;
  }
  function opaqueId(prefix) {
    const nonce = `${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
    return `weaver-${prefix}-${nonce}`;
  }
  var renderTabs = ({ document: document2, properties, relationships, interactions }) => {
    const container = document2.createElement("div");
    applyBasicHook(container, "Tabs");
    const tabs = Array.isArray(properties.tabs) ? properties.tabs : [];
    if (tabs.length === 0)
      return container;
    const storedIndex = interactions.getLocalState("selectedIndex", 0);
    const selectedIndex = Number.isInteger(storedIndex) && storedIndex >= 0 && storedIndex < tabs.length ? storedIndex : 0;
    const childByIndex = /* @__PURE__ */ new Map();
    for (const relationship of relationships) {
      const index = tabChildIndex(relationship);
      if (index !== void 0 && relationship.kind === "single" && relationship.child !== void 0)
        childByIndex.set(index, relationship.child);
    }
    const tablist = document2.createElement("div");
    tablist.setAttribute("role", "tablist");
    const panel = document2.createElement("div");
    panel.setAttribute("role", "tabpanel");
    const panelId = opaqueId("tabpanel");
    panel.id = panelId;
    tabs.forEach((tab, index) => {
      const button = document2.createElement("button");
      button.type = "button";
      button.setAttribute("role", "tab");
      button.id = opaqueId("tab");
      button.setAttribute("aria-controls", panelId);
      button.setAttribute("aria-selected", index === selectedIndex ? "true" : "false");
      button.tabIndex = index === selectedIndex ? 0 : -1;
      if (index === selectedIndex) {
        button.setAttribute("style", "color: var(--a2ui-color-primary, #17e); border-block-end: solid var(--a2ui-color-primary, #17e)");
      }
      if (typeof tab === "object" && tab !== null && !Array.isArray(tab) && typeof tab.title === "string")
        button.textContent = tab.title;
      interactions.registerControl(button, `tab:${index}`);
      const select = (nextIndex, keyboard) => {
        if (keyboard)
          interactions.registerControl(button, `tab:${nextIndex}`);
        else
          button.focus();
        interactions.setLocalState("selectedIndex", nextIndex);
      };
      button.addEventListener("click", () => select(index, false));
      button.addEventListener("keydown", (event) => {
        let nextIndex;
        if (event.key === "ArrowRight")
          nextIndex = (index + 1) % tabs.length;
        else if (event.key === "ArrowLeft")
          nextIndex = (index - 1 + tabs.length) % tabs.length;
        else if (event.key === "Home")
          nextIndex = 0;
        else if (event.key === "End")
          nextIndex = tabs.length - 1;
        if (nextIndex === void 0)
          return;
        event.preventDefault();
        select(nextIndex, true);
      });
      if (index === selectedIndex)
        panel.setAttribute("aria-labelledby", button.id);
      tablist.append(button);
    });
    const selectedChild = childByIndex.get(selectedIndex);
    if (selectedChild !== void 0)
      panel.append(selectedChild);
    container.append(tablist, panel);
    return container;
  };
  function directRelationship(relationships, name) {
    for (const relationship of relationships) {
      const segment = relationship.location[0];
      if (relationship.kind === "single" && relationship.location.length === 1 && segment?.kind === "property" && segment.name === name)
        return relationship.child;
    }
    return void 0;
  }
  var focusableSelector = "button,input,select,textarea,a[href],[tabindex]";
  function usableFocusable(element) {
    if (!("focus" in element) || element.getAttribute("tabindex") === "-1")
      return false;
    if ("disabled" in element && element.disabled)
      return false;
    return !element.hidden;
  }
  function findFocusable(root) {
    const elements = [];
    if (root.matches(focusableSelector) && usableFocusable(root))
      elements.push(root);
    for (const element of root.querySelectorAll(focusableSelector))
      if (usableFocusable(element))
        elements.push(element);
    return elements;
  }
  var renderModal = ({ document: document2, relationships, interactions }) => {
    const container = document2.createElement("div");
    applyBasicHook(container, "Modal");
    const trigger = directRelationship(relationships, "trigger");
    if (trigger === void 0)
      return container;
    const storedOpen = interactions.getLocalState("open", false);
    const open = typeof storedOpen === "boolean" ? storedOpen : false;
    if (!open) {
      const wrapper = document2.createElement("div");
      wrapper.setAttribute("data-a2ui-modal-trigger", "");
      wrapper.append(trigger);
      const triggerControl = findFocusable(wrapper)[0];
      const openModal = () => {
        interactions.setLocalState("open", true);
      };
      wrapper.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openModal();
      }, true);
      if (triggerControl === void 0) {
        wrapper.setAttribute("role", "button");
        wrapper.tabIndex = 0;
        wrapper.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            openModal();
          } else if (event.key === " ")
            event.preventDefault();
        });
        wrapper.addEventListener("keyup", (event) => {
          if (event.key !== " ")
            return;
          event.preventDefault();
          openModal();
        });
        interactions.registerControl(wrapper, "modal-focus");
      } else
        interactions.registerControl(triggerControl, "modal-focus");
      container.append(wrapper);
      return container;
    }
    const backdrop = document2.createElement("div");
    backdrop.setAttribute("data-a2ui-modal-backdrop", "");
    backdrop.style.position = "fixed";
    backdrop.style.inset = "0";
    backdrop.style.zIndex = "1000";
    backdrop.style.display = "flex";
    backdrop.style.alignItems = "center";
    backdrop.style.justifyContent = "center";
    backdrop.style.background = "rgba(0, 0, 0, 0.45)";
    const dialog = document2.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", "Modal dialog");
    dialog.style.background = "Canvas";
    dialog.style.color = "CanvasText";
    dialog.style.maxHeight = "calc(100% - 2rem)";
    dialog.style.maxWidth = "calc(100% - 2rem)";
    dialog.style.overflow = "auto";
    const close = document2.createElement("button");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.textContent = "Close";
    interactions.registerControl(close, "modal-focus");
    const closeModal = () => {
      close.focus({ preventScroll: true });
      interactions.setLocalState("open", false);
    };
    close.addEventListener("click", closeModal);
    const content = directRelationship(relationships, "content");
    dialog.append(close);
    if (content !== void 0)
      dialog.append(content);
    backdrop.append(dialog);
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop)
        closeModal();
    });
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeModal();
        return;
      }
      if (event.key !== "Tab")
        return;
      event.stopPropagation();
      const focusable = findFocusable(dialog);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (first === void 0 || last === void 0)
        return;
      if (event.shiftKey && document2.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document2.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    container.append(backdrop);
    return container;
  };
  var renderButton = ({ document: document2, properties, relationships, checks, interactions }) => {
    const button = document2.createElement("button");
    applyBasicHook(button, "Button");
    button.type = "button";
    const variant = properties.variant === "primary" || properties.variant === "borderless" ? properties.variant : "default";
    button.setAttribute("data-a2ui-variant", variant);
    button.style.cursor = "pointer";
    if (variant === "primary")
      appendBasicStyle(button, "background-color: var(--a2ui-color-primary, #17e); color: var(--a2ui-color-on-primary, white); border: 1px solid transparent");
    else if (variant === "borderless")
      appendBasicStyle(button, "background-color: transparent; color: inherit; border: 1px solid transparent");
    else
      appendBasicStyle(button, `background-color: ${basicControl}; color: inherit; border: 1px solid ${basicOutline}`);
    appendBasicStyle(button, `padding: ${basicSpace} calc(${basicSpace} * 1.5); border-radius: ${basicRadius}`);
    applyBasicMargin(button);
    const children = relationshipChildren(relationships, "child");
    button.append(...children);
    button.disabled = children.length === 0 || checks !== void 0 && checks.status !== "valid";
    if (button.disabled)
      appendBasicStyle(button, "opacity: 0.6");
    button.addEventListener("click", () => {
      interactions.dispatchAction("action");
    });
    return button;
  };

  // node_modules/@weaver/web/dist/basic/icon.js
  var SVG_NAMESPACE = "http://www.w3.org/2000/svg";
  function createSvg(document2, svgPath) {
    const svg = document2.createElementNS(SVG_NAMESPACE, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "24");
    svg.setAttribute("height", "24");
    svg.setAttribute("focusable", "false");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("data-a2ui-component", "Icon");
    applyBasicMargin(svg);
    if (svgPath === void 0) {
      svg.setAttribute("data-a2ui-icon-state", "unresolved");
      return svg;
    }
    const path = document2.createElementNS(SVG_NAMESPACE, "path");
    path.setAttribute("d", svgPath);
    path.setAttribute("fill", "currentColor");
    svg.append(path);
    return svg;
  }
  function createBasicIconRenderer(resolver) {
    return ({ document: document2, properties }) => {
      const name = properties.name;
      if (typeof name === "string")
        return createSvg(document2, resolver?.({ name }));
      if (name !== null && typeof name === "object" && !Array.isArray(name) && typeof name.svgPath === "string")
        return createSvg(document2, name.svgPath);
      return createSvg(document2, void 0);
    };
  }

  // node_modules/@weaver/web/dist/basic/inputs.js
  function createBasicInputRenderers(regexMatcher, dateTimeInputLocalValueResolver) {
    let opaqueId2 = 0;
    const nextId = (kind) => `weaver-basic-${kind}-${++opaqueId2}`;
    const renderTextField = (input) => {
      const { document: document2, properties, interactions } = input;
      const wrapper = componentWrapper(document2, "TextField", properties.variant ?? "shortText");
      const id = nextId("field");
      wrapper.append(labelFor(document2, id, stringOrEmpty(properties.label)));
      const variant = properties.variant === "longText" || properties.variant === "number" || properties.variant === "obscured" ? properties.variant : "shortText";
      const control = variant === "longText" ? document2.createElement("textarea") : document2.createElement("input");
      if (control instanceof document2.defaultView.HTMLInputElement)
        control.type = variant === "number" ? "number" : variant === "obscured" ? "password" : "text";
      control.id = id;
      control.value = typeof properties.value === "string" ? properties.value : "";
      interactions.registerControl(control, "value");
      const regexp = evaluateRegexp(properties.value, properties.validationRegexp, regexMatcher);
      if (regexp !== "absent")
        wrapper.setAttribute("data-a2ui-regexp-state", regexp);
      applyValidation(document2, wrapper, [control], input.checks, nextId, regexp);
      let composing = false;
      control.addEventListener("compositionstart", () => {
        composing = true;
      });
      control.addEventListener("input", () => {
        if (!composing)
          interactions.writeInput("value", control.value);
      });
      control.addEventListener("compositionend", () => {
        composing = false;
        interactions.writeInput("value", control.value);
      });
      wrapper.append(control);
      return wrapper;
    };
    const renderCheckBox = (input) => {
      const { document: document2, properties, interactions } = input;
      const wrapper = componentWrapper(document2, "CheckBox");
      const label = document2.createElement("label");
      const control = document2.createElement("input");
      control.type = "checkbox";
      applyPrimaryAccent(control);
      control.checked = properties.value === true;
      const text = document2.createElement("span");
      text.textContent = stringOrEmpty(properties.label);
      label.append(control, text);
      interactions.registerControl(control, "value");
      applyValidation(document2, wrapper, [control], input.checks, nextId);
      control.addEventListener("change", () => interactions.writeInput("value", control.checked));
      wrapper.append(label);
      return wrapper;
    };
    const renderSlider = (input) => {
      const { document: document2, properties, interactions } = input;
      const wrapper = componentWrapper(document2, "Slider");
      const id = nextId("slider");
      wrapper.append(labelFor(document2, id, stringOrEmpty(properties.label)));
      const control = document2.createElement("input");
      control.id = id;
      control.type = "range";
      applyPrimaryAccent(control);
      control.min = typeof properties.min === "number" && Number.isFinite(properties.min) ? String(properties.min) : "0";
      if (typeof properties.max === "number" && Number.isFinite(properties.max))
        control.max = String(properties.max);
      control.step = "any";
      if (typeof properties.value === "number" && Number.isFinite(properties.value))
        control.value = String(properties.value);
      else
        control.disabled = true;
      interactions.registerControl(control, "value");
      applyValidation(document2, wrapper, [control], input.checks, nextId);
      control.addEventListener("input", () => {
        const value = Number(control.value);
        if (Number.isFinite(value))
          interactions.writeInput("value", value);
      });
      wrapper.append(control);
      return wrapper;
    };
    const renderChoicePicker = (input) => {
      const { document: document2, properties, interactions } = input;
      const wrapper = componentWrapper(document2, "ChoicePicker");
      const fieldset = document2.createElement("fieldset");
      const legend = document2.createElement("legend");
      legend.textContent = stringOrEmpty(properties.label);
      fieldset.append(legend);
      const displayStyle = properties.displayStyle === "chips" ? "chips" : "checkbox";
      wrapper.setAttribute("data-a2ui-display-style", displayStyle);
      appendBasicStyle(fieldset, `border: 1px solid ${basicOutline}; border-radius: ${basicRadius}; padding: ${basicSpace}`);
      const optionsContainer = document2.createElement("div");
      optionsContainer.setAttribute("data-a2ui-choice-options", "");
      if (displayStyle === "chips") {
        optionsContainer.style.display = "flex";
        optionsContainer.style.flexWrap = "wrap";
      }
      const options = optionList(properties.options);
      const selected = stringList(properties.value);
      const multiple = properties.variant === "multipleSelection";
      const radioSelection = multiple ? void 0 : options.find((option) => selected.includes(option.value))?.value;
      const groupName = nextId("choice-group");
      const optionRows = [];
      const controls = [];
      if (properties.filterable === true) {
        const filterId = nextId("choice-filter");
        const filterLabel = labelFor(document2, filterId, "Filter options");
        const filter = document2.createElement("input");
        filter.id = filterId;
        filter.type = "search";
        interactions.registerControl(filter, "filter");
        filter.addEventListener("input", () => {
          const query = filter.value.toLocaleLowerCase();
          optionRows.forEach((row, index) => {
            row.hidden = !stringOrEmpty(options[index]?.label).toLocaleLowerCase().includes(query);
          });
        });
        fieldset.append(filterLabel, filter);
      }
      options.forEach((option, index) => {
        const row = document2.createElement("label");
        const control = document2.createElement("input");
        control.type = multiple ? "checkbox" : "radio";
        applyPrimaryAccent(control);
        control.name = groupName;
        control.value = option.value;
        control.checked = multiple ? selected.includes(option.value) : radioSelection === option.value;
        const text = document2.createElement("span");
        text.textContent = stringOrEmpty(option.label);
        row.append(control, text);
        if (displayStyle === "chips") {
          row.style.display = "inline-flex";
          row.style.alignItems = "center";
          appendBasicStyle(row, `border: 1px solid ${control.checked ? "var(--a2ui-color-primary, #17e)" : basicOutline}; border-radius: 999px; padding: calc(${basicSpace} / 2) ${basicSpace}; background: ${control.checked ? "var(--a2ui-color-control, rgba(127, 127, 127, 0.16))" : basicControl}`);
        } else {
          row.style.display = "block";
          appendBasicStyle(row, `padding: calc(${basicSpace} / 2)`);
        }
        optionRows.push(row);
        controls.push(control);
        interactions.registerControl(control, `option:${index}`);
        control.addEventListener("change", () => {
          if (!multiple) {
            if (control.checked)
              interactions.writeInput("value", [option.value]);
            return;
          }
          const current = stringList(properties.value);
          if (control.checked) {
            if (!current.includes(option.value))
              current.push(option.value);
          } else {
            const position = current.indexOf(option.value);
            if (position >= 0)
              current.splice(position, 1);
          }
          interactions.writeInput("value", current);
        });
        optionsContainer.append(row);
      });
      fieldset.append(optionsContainer);
      applyValidation(document2, wrapper, controls, input.checks, nextId);
      wrapper.append(fieldset);
      return wrapper;
    };
    const renderDateTimeInput = (input) => {
      const { document: document2, properties, interactions } = input;
      const wrapper = componentWrapper(document2, "DateTimeInput");
      const id = nextId("datetime");
      wrapper.append(labelFor(document2, id, stringOrEmpty(properties.label)));
      const control = document2.createElement("input");
      control.id = id;
      const date2 = properties.enableDate === true;
      const time2 = properties.enableTime === true;
      const value = typeof properties.value === "string" ? properties.value : "";
      if (!date2 && !time2) {
        control.type = "text";
        control.value = value;
        control.disabled = true;
      } else if (date2 && !time2) {
        control.type = "date";
        control.value = normalizeDate(value);
        setConstraint(control, "min", properties.min, normalizeDate);
        setConstraint(control, "max", properties.max, normalizeDate);
      } else if (!date2 && time2) {
        control.type = "time";
        control.step = "1";
        control.value = normalizeTime(value);
        setConstraint(control, "min", properties.min, normalizeTime);
        setConstraint(control, "max", properties.max, normalizeTime);
      } else {
        control.type = "datetime-local";
        control.value = isoToLocal(value);
        setConstraint(control, "min", properties.min, isoToLocal);
        setConstraint(control, "max", properties.max, isoToLocal);
      }
      interactions.registerControl(control, "value");
      applyValidation(document2, wrapper, date2 || time2 ? [control] : [], input.checks, nextId);
      if (date2 || time2)
        control.addEventListener("change", () => {
          if (date2 && time2 && dateTimeInputLocalValueResolver !== void 0) {
            if (input.surfaceId === void 0) {
              control.setCustomValidity("Local date and time resolution failed.");
              return;
            }
            let resolution;
            try {
              resolution = dateTimeInputLocalValueResolver({
                surfaceId: input.surfaceId,
                sourceComponentId: input.instance.sourceComponentId,
                scopePath: input.instance.scopePath,
                rawValue: control.value,
                currentValue: value
              });
            } catch {
              control.setCustomValidity("Local date and time resolution failed.");
              return;
            }
            if (resolution.status === "reject") {
              control.setCustomValidity(resolution.message);
              return;
            }
            control.setCustomValidity("");
            interactions.writeInput("value", resolution.value);
            return;
          }
          if (!control.value) {
            interactions.writeInput("value", "");
            return;
          }
          if (date2 && time2) {
            const iso = localToIso(control.value);
            if (iso !== void 0)
              interactions.writeInput("value", iso);
          } else
            interactions.writeInput("value", control.value);
        });
      wrapper.append(control);
      return wrapper;
    };
    return { TextField: renderTextField, CheckBox: renderCheckBox, Slider: renderSlider, ChoicePicker: renderChoicePicker, DateTimeInput: renderDateTimeInput };
  }
  function applyPrimaryAccent(control) {
    control.style.accentColor = "var(--a2ui-color-primary, #17e)";
  }
  function componentWrapper(document2, component, variant) {
    const wrapper = document2.createElement("div");
    applyBasicHook(wrapper, component);
    applyBasicMargin(wrapper);
    if (typeof variant === "string")
      wrapper.setAttribute("data-a2ui-variant", variant);
    return wrapper;
  }
  function labelFor(document2, id, text) {
    const label = document2.createElement("label");
    label.htmlFor = id;
    label.textContent = text;
    return label;
  }
  function stringOrEmpty(value) {
    return typeof value === "string" ? value : "";
  }
  function stringList(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  }
  function optionList(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === "object" && item !== null && typeof item.value === "string") : [];
  }
  function evaluateRegexp(value, pattern, matcher) {
    if (typeof pattern !== "string")
      return "absent";
    if (matcher === void 0)
      return "unavailable";
    if (value === void 0)
      return "pending";
    if (typeof value !== "string")
      return "error";
    try {
      const result = matcher({ value, pattern });
      return typeof result !== "boolean" ? "error" : result ? "passed" : "failed";
    } catch {
      return "error";
    }
  }
  function combinedValidationState(checks, regexp) {
    const core = checks?.status ?? "valid";
    if (core === "invalid" || regexp === "failed")
      return "invalid";
    if (core === "error" || regexp === "error")
      return "error";
    if (core === "pending" || regexp === "pending")
      return "pending";
    return "valid";
  }
  function applyValidation(document2, wrapper, controls, checks, nextId, regexp = "absent") {
    const status = combinedValidationState(checks, regexp);
    if (checks !== void 0 || regexp !== "absent")
      wrapper.setAttribute("data-a2ui-validation-state", status);
    if (status === "invalid")
      controls.forEach((control) => control.setAttribute("aria-invalid", "true"));
    const messages = [];
    const list = document2.createElement("div");
    if (checks?.status === "invalid") {
      for (const check of checks.checks) {
        if (check.status !== "failed")
          continue;
        const message = document2.createElement("div");
        message.id = nextId("validation");
        message.textContent = check.message;
        messages.push(message.id);
        list.append(message);
      }
    }
    if (regexp === "failed") {
      const message = document2.createElement("div");
      message.id = nextId("validation");
      message.textContent = "Value does not match the required format.";
      messages.push(message.id);
      list.append(message);
    }
    if (messages.length === 0)
      return;
    controls.forEach((control) => mergeDescribedBy(control, messages));
    wrapper.append(list);
  }
  function mergeDescribedBy(control, messageIds) {
    const tokens = new Set((control.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean));
    messageIds.forEach((id) => tokens.add(id));
    if (tokens.size > 0)
      control.setAttribute("aria-describedby", [...tokens].join(" "));
  }
  function normalizeDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (match === null)
      return "";
    const date2 = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return date2.getUTCFullYear() === Number(match[1]) && date2.getUTCMonth() === Number(match[2]) - 1 && date2.getUTCDate() === Number(match[3]) ? value : "";
  }
  function normalizeTime(value) {
    return /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?$/.test(value) ? value : "";
  }
  function isoToLocal(value) {
    if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value))
      return "";
    const date2 = new Date(value);
    if (Number.isNaN(date2.getTime()))
      return "";
    const pad = (number) => String(number).padStart(2, "0");
    return `${date2.getFullYear()}-${pad(date2.getMonth() + 1)}-${pad(date2.getDate())}T${pad(date2.getHours())}:${pad(date2.getMinutes())}:${pad(date2.getSeconds())}`;
  }
  function localToIso(value) {
    const date2 = new Date(value);
    return Number.isNaN(date2.getTime()) ? void 0 : date2.toISOString();
  }
  function setConstraint(control, name, value, normalize) {
    if (typeof value !== "string")
      return;
    const normalized = normalize(value);
    if (normalized)
      control.setAttribute(name, normalized);
  }

  // node_modules/@weaver/web/dist/basic/media.js
  var imageFits = {
    contain: "contain",
    cover: "cover",
    fill: "fill",
    none: "none",
    scaleDown: "scale-down"
  };
  var imageVariants = /* @__PURE__ */ new Set([
    "icon",
    "avatar",
    "smallFeature",
    "mediumFeature",
    "largeFeature",
    "header"
  ]);
  function applyResource(element, kind, value, resourcePolicy) {
    if (typeof value !== "string" || value.trim() === "") {
      element.setAttribute("data-a2ui-resource-state", "unavailable");
      return;
    }
    const approved = resourcePolicy?.(Object.freeze({ kind, url: value }));
    if (typeof approved !== "string" || approved.trim() === "") {
      element.setAttribute("data-a2ui-resource-state", "blocked");
      return;
    }
    element.setAttribute("src", approved);
    element.setAttribute("data-a2ui-resource-state", "approved");
  }
  function createBasicMediaRenderers(resourcePolicy) {
    const Image = ({ document: document2, properties }) => {
      const image = document2.createElement("img");
      applyBasicHook(image, "Image");
      image.alt = typeof properties.description === "string" ? properties.description : "";
      const fit = typeof properties.fit === "string" && properties.fit in imageFits ? properties.fit : "fill";
      image.style.objectFit = imageFits[fit];
      image.style.display = "block";
      const variant = typeof properties.variant === "string" && imageVariants.has(properties.variant) ? properties.variant : "mediumFeature";
      image.setAttribute("data-a2ui-variant", variant);
      image.style.maxWidth = "100%";
      if (variant === "icon") {
        image.style.width = "24px";
        image.style.height = "24px";
      } else if (variant === "avatar") {
        image.style.width = "40px";
        image.style.height = "40px";
        image.style.borderRadius = "50%";
      } else if (variant === "smallFeature") {
        image.style.width = "100px";
        image.style.height = "100px";
      } else if (variant === "mediumFeature") {
        image.style.width = "100%";
        image.style.maxWidth = "300px";
      } else if (variant === "largeFeature") {
        image.style.width = "100%";
        image.style.maxHeight = "400px";
      } else {
        image.style.width = "100%";
        image.style.height = "200px";
      }
      applyBasicMargin(image);
      applyResource(image, "image", properties.url, resourcePolicy);
      return image;
    };
    const Video = ({ document: document2, properties }) => {
      const video = document2.createElement("video");
      applyBasicHook(video, "Video");
      video.controls = true;
      video.style.width = "100%";
      video.style.maxWidth = "100%";
      applyBasicMargin(video);
      applyResource(video, "video", properties.url, resourcePolicy);
      return video;
    };
    const AudioPlayer = ({ document: document2, properties }) => {
      const figure = document2.createElement("figure");
      applyBasicHook(figure, "AudioPlayer");
      applyBasicMargin(figure);
      const audio = document2.createElement("audio");
      audio.controls = true;
      applyResource(audio, "audio", properties.url, resourcePolicy);
      figure.append(audio);
      if (typeof properties.description === "string") {
        const caption = document2.createElement("figcaption");
        caption.textContent = properties.description;
        figure.append(caption);
      }
      return figure;
    };
    return { Image, Video, AudioPlayer };
  }

  // node_modules/@weaver/web/dist/basic/createBasicCatalogRendererRegistrations.js
  function createBasicCatalogRendererRegistrations(options) {
    const inputs = createBasicInputRenderers(options.regexMatcher, options.dateTimeInputLocalValueResolver);
    const media = createBasicMediaRenderers(options.resourcePolicy);
    return [
      { catalogId: options.catalogId, component: "Text", render: renderText },
      { catalogId: options.catalogId, component: "Image", render: media.Image },
      { catalogId: options.catalogId, component: "Icon", render: createBasicIconRenderer(options.iconResolver) },
      { catalogId: options.catalogId, component: "Video", render: media.Video },
      { catalogId: options.catalogId, component: "AudioPlayer", render: media.AudioPlayer },
      { catalogId: options.catalogId, component: "Divider", render: renderDivider },
      { catalogId: options.catalogId, component: "Row", render: renderRow },
      { catalogId: options.catalogId, component: "Column", render: renderColumn },
      { catalogId: options.catalogId, component: "List", render: renderList },
      { catalogId: options.catalogId, component: "Card", render: renderCard },
      { catalogId: options.catalogId, component: "Tabs", render: renderTabs },
      { catalogId: options.catalogId, component: "Modal", render: renderModal },
      { catalogId: options.catalogId, component: "Button", render: renderButton },
      { catalogId: options.catalogId, component: "TextField", render: inputs.TextField },
      { catalogId: options.catalogId, component: "CheckBox", render: inputs.CheckBox },
      { catalogId: options.catalogId, component: "Slider", render: inputs.Slider },
      { catalogId: options.catalogId, component: "ChoicePicker", render: inputs.ChoicePicker },
      { catalogId: options.catalogId, component: "DateTimeInput", render: inputs.DateTimeInput }
    ];
  }

  // node_modules/@weaver/web/dist/basic/theme.js
  function createBasicCatalogThemeAdapter(options) {
    return (input) => {
      if (input.catalogId !== options.catalogId)
        return { customProperties: {} };
      const primaryColor = input.theme?.primaryColor;
      const customProperties = {};
      if (typeof primaryColor === "string" && /^#[0-9a-fA-F]{6}$/.test(primaryColor)) {
        customProperties["--a2ui-color-primary"] = primaryColor;
      }
      return { customProperties };
    };
  }

  // node_modules/@weaver/core/dist/data-model/clone.js
  function cloneJson(value) {
    if (value === null || typeof value !== "object")
      return value;
    if (Array.isArray(value))
      return value.map(cloneJson);
    const result = {};
    for (const [key3, entry] of Object.entries(value))
      result[key3] = cloneJson(entry);
    return result;
  }
  function equalJson(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  // node_modules/@weaver/core/dist/data-model/pointer.js
  var success = (value) => ({ ok: true, value });
  function parsePointer(path) {
    if (path === "/")
      return success([]);
    if (!path.startsWith("/") || path.startsWith("#/")) {
      return { ok: false, error: { code: "INVALID_POINTER", path } };
    }
    const tokens = [];
    for (const encoded of path.slice(1).split("/")) {
      const decoded = decodePointerToken(encoded);
      if (decoded === void 0) {
        return { ok: false, error: { code: "INVALID_POINTER_ESCAPE", path } };
      }
      tokens.push(decoded);
    }
    return success(tokens);
  }
  function decodePointerToken(encoded) {
    let token = "";
    for (let index = 0; index < encoded.length; index += 1) {
      const character = encoded[index];
      if (character !== "~") {
        token += character;
        continue;
      }
      const escape = encoded[index + 1];
      if (escape === "0")
        token += "~";
      else if (escape === "1")
        token += "/";
      else
        return void 0;
      index += 1;
    }
    return token;
  }
  function formatPointer(tokens) {
    if (tokens.length === 0)
      return "/";
    return `/${tokens.map((token) => token.replaceAll("~", "~0").replaceAll("/", "~1")).join("/")}`;
  }
  function readTokens(root, tokens) {
    let current = root;
    for (const token of tokens) {
      if (current === null || typeof current !== "object")
        return void 0;
      if (Array.isArray(current)) {
        if (!isArrayIndex(token))
          return void 0;
        const index = Number(token);
        if (index >= current.length)
          return void 0;
        current = current[index];
      } else {
        current = Object.prototype.hasOwnProperty.call(current, token) ? current[token] : void 0;
      }
    }
    return current;
  }
  function isArrayIndex(token) {
    return /^(0|[1-9]\d*)$/.test(token);
  }
  function pointersRelated(left, right) {
    const common = Math.min(left.length, right.length);
    for (let index = 0; index < common; index += 1) {
      if (left[index] !== right[index])
        return false;
    }
    return true;
  }

  // node_modules/@weaver/core/dist/data-context/path.js
  var success2 = (value) => ({ ok: true, value });
  function resolveScopedPath(path, scopeTokens) {
    if (path.startsWith("/")) {
      const parsed = parsePointer(path);
      if (!parsed.ok) {
        return {
          ok: false,
          error: {
            code: parsed.error.code === "INVALID_POINTER_ESCAPE" ? "INVALID_POINTER_ESCAPE" : "INVALID_PATH",
            path
          }
        };
      }
      return success2({ absolutePath: formatPointer(parsed.value), tokens: parsed.value });
    }
    if (path.length === 0 || path.startsWith("#")) {
      return { ok: false, error: { code: "INVALID_PATH", path } };
    }
    if (scopeTokens.length === 0) {
      return { ok: false, error: { code: "RELATIVE_PATH_OUTSIDE_COLLECTION", path } };
    }
    const relativeTokens = [];
    for (const encoded of path.split("/")) {
      const token = decodePointerToken(encoded);
      if (token === void 0) {
        return { ok: false, error: { code: "INVALID_POINTER_ESCAPE", path } };
      }
      relativeTokens.push(token);
    }
    const tokens = [...scopeTokens, ...relativeTokens];
    return success2({ absolutePath: formatPointer(tokens), tokens });
  }

  // node_modules/@weaver/core/dist/data-context/DataContext.js
  var success3 = (value) => ({ ok: true, value });
  var DataContext = class _DataContext {
    #dataModel;
    #scopeTokens;
    #collectionIndex;
    constructor(dataModel, scopeTokens, collectionIndex, owned) {
      this.#dataModel = owned ? dataModel : cloneJson(dataModel);
      this.#scopeTokens = Object.freeze([...scopeTokens]);
      this.#collectionIndex = collectionIndex;
    }
    static root(dataModel) {
      return new _DataContext(dataModel, [], void 0, false);
    }
    get scopePath() {
      return formatPointer(this.#scopeTokens);
    }
    get collectionIndex() {
      return this.#collectionIndex;
    }
    resolvePath(path) {
      const resolved = resolveScopedPath(path, this.#scopeTokens);
      return resolved.ok ? success3(resolved.value.absolutePath) : resolved;
    }
    get(path) {
      const resolved = resolveScopedPath(path, this.#scopeTokens);
      if (!resolved.ok)
        return resolved;
      const value = readTokens(this.#dataModel, resolved.value.tokens);
      return success3(value === void 0 ? void 0 : cloneJson(value));
    }
    resolveBinding(binding) {
      return this.get(binding.path);
    }
    resolveBindingPath(binding) {
      return this.resolvePath(binding.path);
    }
    createCollectionItemContext(collectionPath, index) {
      if (!Number.isSafeInteger(index) || index < 0) {
        return { ok: false, error: { code: "INVALID_COLLECTION_INDEX", index } };
      }
      const resolved = resolveScopedPath(collectionPath, this.#scopeTokens);
      if (!resolved.ok)
        return resolved;
      const collection = readTokens(this.#dataModel, resolved.value.tokens);
      if (collection === void 0) {
        return {
          ok: false,
          error: { code: "COLLECTION_NOT_FOUND", path: resolved.value.absolutePath }
        };
      }
      if (!Array.isArray(collection)) {
        return {
          ok: false,
          error: { code: "COLLECTION_NOT_ARRAY", path: resolved.value.absolutePath }
        };
      }
      if (index >= collection.length) {
        return {
          ok: false,
          error: {
            code: "COLLECTION_INDEX_OUT_OF_RANGE",
            path: resolved.value.absolutePath,
            index,
            length: collection.length
          }
        };
      }
      return success3(new _DataContext(this.#dataModel, [...resolved.value.tokens, String(index)], index, true));
    }
  };

  // node_modules/@weaver/core/dist/data-context/types.js
  function isDataPathBinding(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return false;
    const keys = Object.keys(value);
    return keys.length === 1 && keys[0] === "path" && typeof value.path === "string";
  }

  // node_modules/@weaver/core/dist/functions/FunctionRegistry.js
  var key = (catalogId, name) => JSON.stringify([catalogId, name]);
  var FunctionRegistry = class {
    #catalogs;
    #implementations = /* @__PURE__ */ new Map();
    constructor(catalogs) {
      this.#catalogs = catalogs;
    }
    register(registration) {
      const declaration = this.#catalogs.getFunctionDefinition(registration.catalogId, registration.name);
      if (!declaration.ok)
        return { ok: false, error: declaration.error };
      const identity = key(registration.catalogId, registration.name);
      if (this.#implementations.has(identity)) {
        return {
          ok: false,
          error: {
            code: "FUNCTION_IMPLEMENTATION_ALREADY_REGISTERED",
            message: "A function implementation is already registered",
            catalogId: registration.catalogId,
            functionName: registration.name
          }
        };
      }
      this.#implementations.set(identity, Object.freeze({ ...registration }));
      return {
        ok: true,
        value: {
          catalogId: registration.catalogId,
          name: registration.name,
          returnType: declaration.value.returnType,
          effect: registration.effect
        }
      };
    }
    has(catalogId, functionName) {
      return this.#implementations.has(key(catalogId, functionName));
    }
    list(catalogId) {
      const result = [];
      for (const [identity] of this.#implementations) {
        const [registeredCatalogId, name] = JSON.parse(identity);
        if (registeredCatalogId !== catalogId)
          continue;
        const definition = this.#catalogs.getFunctionDefinition(catalogId, name);
        const registration = this.#implementations.get(identity);
        if (definition.ok && registration !== void 0) {
          result.push({ catalogId, name, returnType: definition.value.returnType, effect: registration.effect });
        }
      }
      return result;
    }
    /** Internal evaluator seam; listing APIs never expose this reference. */
    getRegistration(catalogId, functionName) {
      return this.#implementations.get(key(catalogId, functionName));
    }
  };

  // node_modules/@weaver/core/dist/functions/types.js
  function isFunctionCall(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      return false;
    const record = value;
    if (typeof record.call !== "string" || record.args === null || typeof record.args !== "object" || Array.isArray(record.args)) {
      return false;
    }
    const argsPrototype = Object.getPrototypeOf(record.args);
    if (argsPrototype !== Object.prototype && argsPrototype !== null)
      return false;
    return !("returnType" in record) || typeof record.returnType === "string" && ["string", "number", "boolean", "array", "object", "any", "void"].includes(record.returnType);
  }

  // node_modules/@weaver/core/dist/functions/FunctionEvaluator.js
  var MAX_DEFAULT_DEPTH = 32;
  var RecursiveFunctionFailure = class {
    error;
    constructor(error2) {
      this.error = error2;
    }
  };
  function isPlainObject(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }
  function isJsonSafe(value, ancestors = /* @__PURE__ */ new Set()) {
    if (value === null || typeof value === "string" || typeof value === "boolean")
      return true;
    if (typeof value === "number")
      return Number.isFinite(value);
    if (typeof value !== "object" || ancestors.has(value))
      return false;
    ancestors.add(value);
    const safe = Array.isArray(value) ? Object.keys(value).length === value.length && value.every((entry) => isJsonSafe(entry, ancestors)) : isPlainObject(value) && Object.values(value).every((entry) => isJsonSafe(entry, ancestors));
    ancestors.delete(value);
    return safe;
  }
  function defensiveValue(value, catalogId, functionName) {
    if (value === void 0)
      return { ok: true, value: void 0 };
    if (!isJsonSafe(value)) {
      return {
        ok: false,
        error: {
          code: "FUNCTION_ARGUMENT_RESOLUTION_FAILED",
          message: "Function argument is not JSON-compatible",
          catalogId,
          functionName
        }
      };
    }
    return { ok: true, value: cloneJson(value) };
  }
  function actualType(value) {
    if (value === null)
      return "null";
    if (value === void 0)
      return "undefined";
    if (Array.isArray(value))
      return "array";
    if (typeof value === "number" && !Number.isFinite(value))
      return "non-finite number";
    if (typeof value === "object" && !isPlainObject(value))
      return "class instance";
    return typeof value;
  }
  function validReturnValue(value, expected) {
    if (expected === "void")
      return value === void 0;
    if (!isJsonSafe(value))
      return false;
    switch (expected) {
      case "string":
        return typeof value === "string";
      case "number":
        return typeof value === "number" && Number.isFinite(value);
      case "boolean":
        return typeof value === "boolean";
      case "array":
        return Array.isArray(value);
      case "object":
        return isPlainObject(value);
      case "any":
        return true;
    }
  }
  function argumentError(catalogId, functionName, message, cause) {
    return {
      ok: false,
      error: {
        code: "FUNCTION_ARGUMENT_RESOLUTION_FAILED",
        message,
        catalogId,
        functionName,
        ...cause === void 0 ? {} : { cause }
      }
    };
  }
  var FunctionEvaluator = class {
    #catalogs;
    #functions;
    #maxDepth;
    constructor(catalogs, functions, options = {}) {
      this.#catalogs = catalogs;
      this.#functions = functions;
      this.#maxDepth = Number.isSafeInteger(options.maxDepth) && (options.maxDepth ?? 0) > 0 ? options.maxDepth : MAX_DEFAULT_DEPTH;
    }
    evaluate(catalogId, functionCall, dataContext) {
      return this.#evaluate(catalogId, functionCall, dataContext, 0, false);
    }
    /** Executes a direct local-action root; all recursive evaluation remains pure. */
    evaluateAction(catalogId, functionCall, dataContext) {
      return this.#evaluate(catalogId, functionCall, dataContext, 0, true);
    }
    #evaluate(catalogId, functionCall, dataContext, depth, allowActionRoot) {
      let validation;
      try {
        validation = this.#catalogs.validateFunctionCall(catalogId, functionCall);
      } catch {
        return {
          ok: false,
          error: {
            code: "FUNCTION_VALIDATION_FAILED",
            message: "Function call validation failed",
            catalogId,
            issues: [{ path: "/", message: "Unable to inspect FunctionCall", keyword: "type" }]
          }
        };
      }
      if (!validation.ok)
        return { ok: false, error: validation.error };
      if (!isFunctionCall(validation.value)) {
        return {
          ok: false,
          error: {
            code: "FUNCTION_VALIDATION_FAILED",
            message: "Validated value is not a FunctionCall",
            catalogId,
            functionName: "",
            issues: [{ path: "/", message: "Expected FunctionCall", keyword: "type" }]
          }
        };
      }
      const call = validation.value;
      if (depth >= this.#maxDepth) {
        return {
          ok: false,
          error: {
            code: "FUNCTION_MAX_DEPTH_EXCEEDED",
            message: `Function nesting exceeds the Weaver limit of ${this.#maxDepth}`,
            catalogId,
            functionName: call.call
          }
        };
      }
      const functionName = call.call;
      const definitionResult = this.#catalogs.getFunctionDefinition(catalogId, functionName);
      if (!definitionResult.ok)
        return { ok: false, error: definitionResult.error };
      const definition = definitionResult.value;
      const registration = this.#functions.getRegistration(catalogId, functionName);
      if (registration === void 0) {
        return {
          ok: false,
          error: {
            code: "FUNCTION_IMPLEMENTATION_NOT_FOUND",
            message: "The catalog function has no registered implementation",
            catalogId,
            functionName
          }
        };
      }
      if (registration.effect === "action" && !allowActionRoot) {
        return {
          ok: false,
          error: {
            code: "FUNCTION_EFFECT_NOT_ALLOWED",
            message: "Action-effect functions may execute only as a direct local-action root",
            catalogId,
            functionName
          }
        };
      }
      const resolvedArgs = {};
      for (const [name, value] of Object.entries(call.args)) {
        const resolved = this.#resolveArgument(catalogId, functionName, value, definition.arguments[name] ?? { kind: "literal" }, dataContext, depth);
        if (!resolved.ok)
          return resolved;
        resolvedArgs[name] = resolved.value;
      }
      let result;
      try {
        const context = {
          catalogId,
          dataContext,
          evaluateFunctionCall: (nestedCall) => this.#evaluate(catalogId, nestedCall, dataContext, depth + 1, false),
          propagateFunctionFailure: (error2) => {
            throw new RecursiveFunctionFailure(error2);
          }
        };
        result = registration.implementation(resolvedArgs, context);
      } catch (cause) {
        if (cause instanceof RecursiveFunctionFailure)
          return { ok: false, error: cause.error };
        return {
          ok: false,
          error: {
            code: "FUNCTION_EXECUTION_FAILED",
            message: "Trusted function implementation failed",
            catalogId,
            functionName
          }
        };
      }
      if (!validReturnValue(result, definition.returnType)) {
        return {
          ok: false,
          error: {
            code: "FUNCTION_RETURN_TYPE_MISMATCH",
            message: "Function implementation returned a value outside its catalog contract",
            catalogId,
            functionName,
            expected: definition.returnType,
            actual: actualType(result)
          }
        };
      }
      return { ok: true, value: result === void 0 ? void 0 : cloneJson(result) };
    }
    #resolveArgument(catalogId, functionName, value, definition, dataContext, depth) {
      if (definition.kind === "arrayOfDynamicValues") {
        if (!Array.isArray(value))
          return defensiveValue(value, catalogId, functionName);
        const values = [];
        for (const entry of value) {
          const resolved = this.#resolveArgument(catalogId, functionName, entry, { kind: "dynamicValue" }, dataContext, depth);
          if (!resolved.ok)
            return resolved;
          values.push(resolved.value);
        }
        return { ok: true, value: values };
      }
      if (definition.kind === "literalObject") {
        if (!isPlainObject(value))
          return defensiveValue(value, catalogId, functionName);
        const fields = {};
        for (const [name, entry] of Object.entries(value)) {
          const fieldDefinition = definition.properties?.[name];
          const resolved = fieldDefinition === void 0 ? defensiveValue(entry, catalogId, functionName) : this.#resolveArgument(catalogId, functionName, entry, fieldDefinition, dataContext, depth);
          if (!resolved.ok)
            return resolved;
          fields[name] = resolved.value;
        }
        return { ok: true, value: fields };
      }
      if (definition.kind === "dynamicValue" || definition.kind === "dynamicString" || definition.kind === "dynamicNumber" || definition.kind === "dynamicBoolean" || definition.kind === "dynamicStringList") {
        if (isDataPathBinding(value)) {
          const resolved = dataContext.resolveBinding(value);
          if (!resolved.ok)
            return argumentError(catalogId, functionName, "Data binding could not be resolved", resolved.error);
          return defensiveValue(resolved.value, catalogId, functionName);
        }
        if (isFunctionCall(value))
          return this.#evaluate(catalogId, value, dataContext, depth + 1, false);
      }
      return defensiveValue(value, catalogId, functionName);
    }
  };

  // node_modules/@weaver/core/dist/actions/ActionContextResolver.js
  function cloneJson2(value) {
    if (value === null || typeof value !== "object")
      return value;
    if (Array.isArray(value))
      return value.map(cloneJson2);
    return Object.fromEntries(Object.entries(value).map(([key3, entry]) => [key3, cloneJson2(entry)]));
  }
  function isAllowedLiteral(value) {
    return typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value) || Array.isArray(value);
  }
  var ActionContextResolver = class {
    catalogs;
    functionEvaluator;
    constructor(catalogs, functionEvaluator) {
      this.catalogs = catalogs;
      this.functionEvaluator = functionEvaluator;
    }
    resolve(catalogId, context, dataContext) {
      const resolved = {};
      for (const [key3, value] of Object.entries(context)) {
        if (isDataPathBinding(value)) {
          const binding = dataContext.resolveBinding(value);
          if (!binding.ok) {
            return { ok: false, error: { code: "ACTION_CONTEXT_RESOLUTION_FAILED", message: "Event context binding could not be resolved", key: key3 } };
          }
          if (binding.value === void 0) {
            return { ok: false, error: { code: "ACTION_CONTEXT_VALUE_UNAVAILABLE", message: "Event context value is unavailable", key: key3 } };
          }
          resolved[key3] = cloneJson2(binding.value);
          continue;
        }
        if (isFunctionCall(value)) {
          const definition = this.catalogs.getFunctionDefinition(catalogId, value.call);
          if (definition.ok && definition.value.returnType === "void") {
            return { ok: false, error: { code: "ACTION_CONTEXT_VOID_FUNCTION", message: "Void functions cannot produce event context", key: key3, functionName: value.call } };
          }
          const evaluated = this.functionEvaluator.evaluate(catalogId, value, dataContext);
          if (!evaluated.ok) {
            return { ok: false, error: { code: "ACTION_CONTEXT_RESOLUTION_FAILED", message: "Event context function failed", key: key3, cause: evaluated.error } };
          }
          if (evaluated.value === void 0) {
            return { ok: false, error: { code: "ACTION_CONTEXT_VALUE_UNAVAILABLE", message: "Event context value is unavailable", key: key3 } };
          }
          resolved[key3] = cloneJson2(evaluated.value);
          continue;
        }
        if (!isAllowedLiteral(value)) {
          return { ok: false, error: { code: "ACTION_CONTEXT_RESOLUTION_FAILED", message: "Event context value is not an allowed DynamicValue", key: key3 } };
        }
        resolved[key3] = cloneJson2(value);
      }
      return { ok: true, value: resolved };
    }
  };

  // node_modules/@weaver/core/dist/checks/CheckEvaluator.js
  function actualType2(value) {
    if (value === null)
      return "null";
    if (Array.isArray(value))
      return "array";
    return typeof value;
  }
  function statusFor(checks) {
    if (checks.some(({ status }) => status === "failed"))
      return "invalid";
    if (checks.some(({ status }) => status === "error"))
      return "error";
    if (checks.some(({ status }) => status === "pending"))
      return "pending";
    return "valid";
  }
  function isCheckRule(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) && typeof value.message === "string" && Object.hasOwn(value, "condition");
  }
  var CheckEvaluator = class {
    catalogs;
    functionEvaluator;
    constructor(catalogs, functionEvaluator) {
      this.catalogs = catalogs;
      this.functionEvaluator = functionEvaluator;
    }
    evaluate(catalogId, instance, dataContext) {
      const checkable = this.catalogs.isComponentCheckable(catalogId, instance.component);
      if (!checkable)
        return { ok: true, value: this.snapshot(instance, false, []) };
      const definitions = Array.isArray(instance.definition.checks) ? instance.definition.checks : [];
      const checks = definitions.map((definition, index) => this.evaluateCheck(catalogId, definition, index, dataContext));
      return { ok: true, value: this.snapshot(instance, true, checks) };
    }
    evaluateTree(surface, instances) {
      if (!instances.ready || instances.root === void 0) {
        return { ok: true, value: { ready: false, components: [] } };
      }
      const components = [];
      const visit = (instance, context) => {
        const own = this.evaluate(surface.catalogId, instance, context);
        if (!own.ok)
          return own;
        components.push(own.value);
        for (const relationship of instance.relationships) {
          if (relationship.kind === "single") {
            if (relationship.child !== void 0) {
              const failed2 = visit(relationship.child, context);
              if (failed2 !== void 0)
                return failed2;
            }
          } else if (relationship.kind === "list") {
            for (const child of relationship.children) {
              const failed2 = visit(child, context);
              if (failed2 !== void 0)
                return failed2;
            }
          } else {
            for (const child of relationship.children) {
              const childContext = child.collectionIndex === void 0 ? { ok: false, error: { code: "INVALID_COLLECTION_INDEX", index: Number.NaN } } : context.createCollectionItemContext(relationship.collectionPath, child.collectionIndex);
              if (!childContext.ok) {
                return {
                  ok: false,
                  error: {
                    code: "CHECK_DATA_CONTEXT_RECONSTRUCTION_FAILED",
                    message: "Could not reconstruct the component check data scope",
                    sourceComponentId: child.sourceComponentId,
                    scopePath: child.scopePath,
                    cause: { ...childContext.error }
                  }
                };
              }
              const failed2 = visit(child, childContext.value);
              if (failed2 !== void 0)
                return failed2;
            }
          }
        }
        return void 0;
      };
      const failed = visit(instances.root, DataContext.root(surface.dataModel));
      return failed ?? { ok: true, value: { ready: true, components } };
    }
    snapshot(instance, checkable, checks) {
      return {
        sourceComponentId: instance.sourceComponentId,
        scopePath: instance.scopePath,
        ...instance.collectionIndex === void 0 ? {} : { collectionIndex: instance.collectionIndex },
        checkable,
        status: statusFor(checks),
        checks
      };
    }
    evaluateCheck(catalogId, definition, index, dataContext) {
      if (!isCheckRule(definition))
        return this.typeError(index, "", definition);
      const { condition, message } = definition;
      if (typeof condition === "boolean")
        return this.booleanResult(index, message, condition);
      if (isDataPathBinding(condition)) {
        const resolved = dataContext.resolveBinding(condition);
        if (!resolved.ok) {
          return this.issueResult(index, message, {
            code: "CHECK_BINDING_RESOLUTION_FAILED",
            error: { ...resolved.error }
          });
        }
        return this.valueResult(index, message, resolved.value);
      }
      if (isFunctionCall(condition)) {
        const evaluated = this.functionEvaluator.evaluate(catalogId, condition, dataContext);
        if (!evaluated.ok) {
          return this.issueResult(index, message, {
            code: "CHECK_FUNCTION_EVALUATION_FAILED",
            error: { ...evaluated.error }
          });
        }
        return this.valueResult(index, message, evaluated.value);
      }
      return this.typeError(index, message, condition);
    }
    valueResult(index, message, value) {
      if (value === void 0)
        return { index, status: "pending", message, issues: [] };
      if (typeof value === "boolean")
        return this.booleanResult(index, message, value);
      return this.typeError(index, message, value);
    }
    booleanResult(index, message, value) {
      return { index, status: value ? "passed" : "failed", message, issues: [] };
    }
    typeError(index, message, value) {
      return this.issueResult(index, message, {
        code: "CHECK_CONDITION_TYPE_MISMATCH",
        expected: "boolean",
        actual: actualType2(value)
      });
    }
    issueResult(index, message, issue3) {
      return { index, status: "error", message, issues: [issue3] };
    }
  };

  // node_modules/@weaver/core/dist/actions/ActionDispatcher.js
  function cloneJson3(value) {
    if (value === null || typeof value !== "object")
      return value;
    if (Array.isArray(value))
      return value.map(cloneJson3);
    return Object.fromEntries(Object.entries(value).map(([key3, entry]) => [key3, cloneJson3(entry)]));
  }
  function isPlainObject2(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  function contextFor(surface, instance) {
    const root = DataContext.root(surface.dataModel);
    if (instance.scopePath === "/")
      return { ok: true, value: root };
    const index = instance.collectionIndex;
    const separator = instance.scopePath.lastIndexOf("/");
    if (index === void 0 || separator < 0 || instance.scopePath.slice(separator + 1) !== String(index)) {
      return { ok: false, error: { code: "INVALID_COLLECTION_INDEX", index: index ?? Number.NaN } };
    }
    const collectionPath = instance.scopePath.slice(0, separator) || "/";
    return root.createCollectionItemContext(collectionPath, index);
  }
  var ActionDispatcher = class {
    catalogs;
    functionEvaluator;
    checkEvaluator;
    #contextResolver;
    #now;
    constructor(catalogs, functionEvaluator, checkEvaluator, options = {}) {
      this.catalogs = catalogs;
      this.functionEvaluator = functionEvaluator;
      this.checkEvaluator = checkEvaluator;
      this.#contextResolver = new ActionContextResolver(catalogs, functionEvaluator);
      this.#now = options.now ?? (() => /* @__PURE__ */ new Date());
    }
    dispatch({ surface, instance, actionProperty }) {
      const metadata = this.catalogs.getActionProperties(surface.catalogId, instance.component);
      if (!metadata.ok || !metadata.value.includes(actionProperty)) {
        return { ok: false, error: {
          code: "ACTION_PROPERTY_NOT_ALLOWED",
          message: "Property is not a catalog-declared Action",
          actionProperty,
          ...metadata.ok ? {} : { cause: metadata.error }
        } };
      }
      if (!Object.hasOwn(instance.definition, actionProperty)) {
        return { ok: false, error: { code: "ACTION_NOT_FOUND", message: "Requested action is absent", actionProperty } };
      }
      const action = instance.definition[actionProperty];
      if (!isPlainObject2(action)) {
        return { ok: false, error: { code: "ACTION_INVALID", message: "Action definition is invalid", actionProperty } };
      }
      const dataContext = contextFor(surface, instance);
      if (!dataContext.ok) {
        return { ok: false, error: { code: "ACTION_DATA_CONTEXT_FAILED", message: "Instance data scope could not be reconstructed", cause: dataContext.error } };
      }
      const checks = this.checkEvaluator.evaluate(surface.catalogId, instance, dataContext.value);
      if (!checks.ok) {
        return { ok: false, error: { code: "ACTION_CHECK_EVALUATION_FAILED", message: "Component checks could not be evaluated", cause: checks.error } };
      }
      if (checks.value.status !== "valid") {
        return { ok: false, error: { code: "ACTION_BLOCKED_BY_CHECKS", message: "Only valid components may dispatch actions", checks: structuredClone(checks.value) } };
      }
      const hasFunction = Object.hasOwn(action, "functionCall");
      const hasEvent = Object.hasOwn(action, "event");
      if (hasFunction === hasEvent) {
        return { ok: false, error: { code: "ACTION_INVALID", message: "Action must have exactly one path", actionProperty } };
      }
      if (hasFunction) {
        const call = action.functionCall;
        if (!isFunctionCall(call)) {
          return { ok: false, error: { code: "ACTION_INVALID", message: "Local function action is invalid", actionProperty } };
        }
        const evaluated = this.functionEvaluator.evaluateAction(surface.catalogId, call, dataContext.value);
        if (!evaluated.ok) {
          return { ok: false, error: { code: "LOCAL_FUNCTION_FAILED", message: "Local action function failed", cause: evaluated.error } };
        }
        return { ok: true, value: { kind: "localFunction", value: evaluated.value === void 0 ? void 0 : cloneJson3(evaluated.value) } };
      }
      const event = action.event;
      if (!isPlainObject2(event) || typeof event.name !== "string" || !isPlainObject2(event.context)) {
        return { ok: false, error: { code: "ACTION_INVALID", message: "Server event action is invalid", actionProperty } };
      }
      const context = this.#contextResolver.resolve(surface.catalogId, event.context, dataContext.value);
      if (!context.ok)
        return context;
      if (surface.sendDataModel && !isPlainObject2(surface.dataModel)) {
        return { ok: false, error: { code: "CLIENT_DATA_MODEL_NOT_OBJECT", message: "Synchronized surface data must be a JSON object" } };
      }
      const message = {
        version: "v0.9.1",
        action: {
          name: event.name,
          surfaceId: surface.surfaceId,
          sourceComponentId: instance.sourceComponentId,
          timestamp: this.#now().toISOString(),
          context: cloneJson3(context.value)
        }
      };
      let transportMetadata;
      if (surface.sendDataModel) {
        transportMetadata = { a2uiClientDataModel: {
          version: "v0.9.1",
          surfaces: { [surface.surfaceId]: cloneJson3(surface.dataModel) }
        } };
      }
      return { ok: true, value: {
        kind: "serverEvent",
        message,
        ...transportMetadata === void 0 ? {} : { metadata: transportMetadata }
      } };
    }
  };

  // node_modules/@weaver/core/dist/basic-functions/formatString.js
  var _a;
  var ExpressionParser = class {
    source;
    #index = 0;
    constructor(source) {
      this.source = source;
    }
    parse() {
      const value = this.#expression();
      this.#space();
      if (this.#index !== this.source.length)
        throw new Error("Unexpected interpolation input");
      return value;
    }
    #expression() {
      this.#space();
      if (this.source.startsWith("${", this.#index)) {
        const end = findInterpolationEnd(this.source, this.#index + 2);
        const value = new _a(this.source.slice(this.#index + 2, end)).parse();
        this.#index = end + 1;
        return value;
      }
      const character = this.source[this.#index];
      if (character === "'" || character === '"')
        return this.#string(character);
      const remaining = this.source.slice(this.#index);
      for (const [word, value] of [["true", true], ["false", false], ["null", null]]) {
        if (remaining.startsWith(word) && this.#boundary(this.#index + word.length)) {
          this.#index += word.length;
          return value;
        }
      }
      const number = remaining.match(/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/u)?.[0];
      if (number !== void 0 && this.#boundary(this.#index + number.length)) {
        this.#index += number.length;
        return Number(number);
      }
      const start = this.#index;
      while (this.#index < this.source.length && !/[\s():,]/.test(this.source[this.#index]))
        this.#index++;
      const name = this.source.slice(start, this.#index);
      if (name === "")
        throw new Error("Expected expression");
      this.#space();
      if (this.source[this.#index] === "(")
        return this.#call(name);
      return { path: name };
    }
    #call(name) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
        throw new Error("Invalid function name");
      this.#index++;
      const args = {};
      this.#space();
      if (this.source[this.#index] === ")") {
        this.#index++;
        return { call: name, args };
      }
      while (true) {
        this.#space();
        const match = this.source.slice(this.#index).match(/^[A-Za-z_][A-Za-z0-9_]*/u);
        if (match === null)
          throw new Error("Missing function argument name");
        const argumentName = match[0];
        this.#index += argumentName.length;
        this.#space();
        if (this.source[this.#index] !== ":")
          throw new Error("Missing function argument colon");
        this.#index++;
        args[argumentName] = this.#expression();
        this.#space();
        if (this.source[this.#index] === ")") {
          this.#index++;
          break;
        }
        if (this.source[this.#index] !== ",")
          throw new Error("Expected comma or closing parenthesis");
        this.#index++;
      }
      return { call: name, args };
    }
    #string(quote) {
      this.#index++;
      let output = "";
      while (this.#index < this.source.length) {
        const character = this.source[this.#index++];
        if (character === quote)
          return output;
        if (character === "\\") {
          if (this.#index >= this.source.length)
            throw new Error("Unterminated string escape");
          const escaped = this.source[this.#index++];
          if (escaped !== quote && escaped !== "\\")
            throw new Error("Unsupported string escape");
          output += escaped;
        } else
          output += character;
      }
      throw new Error("Unterminated string");
    }
    #space() {
      while (/\s/.test(this.source[this.#index] ?? ""))
        this.#index++;
    }
    #boundary(index) {
      return index === this.source.length || /[\s,)]/.test(this.source[index]);
    }
  };
  _a = ExpressionParser;
  function findInterpolationEnd(source, start) {
    let parentheses = 0;
    let interpolation = 0;
    let quote;
    for (let index = start; index < source.length; index++) {
      const character = source[index];
      if (quote !== void 0) {
        if (character === "\\")
          index++;
        else if (character === quote)
          quote = void 0;
        continue;
      }
      if (character === "'" || character === '"') {
        quote = character;
        continue;
      }
      if (source.startsWith("${", index)) {
        interpolation++;
        index++;
        continue;
      }
      if (character === "(")
        parentheses++;
      else if (character === ")") {
        if (parentheses === 0)
          throw new Error("Invalid nesting");
        parentheses--;
      } else if (character === "}") {
        if (interpolation > 0)
          interpolation--;
        else if (parentheses === 0)
          return index;
      }
    }
    throw new Error("Unterminated interpolation");
  }

  // node_modules/@weaver/core/dist/basic-catalog/generated-basic-catalog.js
  var A2UI_V091_BASIC_CATALOG_ID = "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json";
  var A2UI_V091_BASIC_CATALOG = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
    "title": "A2UI Basic Catalog",
    "description": "Unified catalog of basic A2UI components and functions.",
    "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
    "components": {
      "Text": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "accessibility": {
            "$ref": "common_types.json#/$defs/AccessibilityAttributes"
          },
          "weight": {
            "type": "number",
            "description": "The relative weight of this component within a Row or Column. This is similar to the CSS 'flex-grow' property. Note: this may ONLY be set when the component is a direct descendant of a Row or Column."
          },
          "component": {
            "const": "Text"
          },
          "text": {
            "$ref": "common_types.json#/$defs/DynamicString",
            "description": "The text content to display. While simple Markdown formatting is supported (i.e. without HTML, images, or links), utilizing dedicated UI components is generally preferred for a richer and more structured presentation."
          },
          "variant": {
            "type": "string",
            "description": "A hint for the base text style.",
            "enum": [
              "h1",
              "h2",
              "h3",
              "h4",
              "h5",
              "caption",
              "body"
            ],
            "default": "body"
          }
        },
        "required": [
          "id",
          "component",
          "text"
        ],
        "additionalProperties": false
      },
      "Image": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "accessibility": {
            "$ref": "common_types.json#/$defs/AccessibilityAttributes"
          },
          "weight": {
            "type": "number",
            "description": "The relative weight of this component within a Row or Column. This is similar to the CSS 'flex-grow' property. Note: this may ONLY be set when the component is a direct descendant of a Row or Column."
          },
          "component": {
            "const": "Image"
          },
          "url": {
            "$ref": "common_types.json#/$defs/DynamicString",
            "description": "The URL of the image to display."
          },
          "description": {
            "$ref": "common_types.json#/$defs/DynamicString",
            "description": "Accessibility text for the image."
          },
          "fit": {
            "type": "string",
            "description": "Specifies how the image should be resized to fit its container. This corresponds to the CSS 'object-fit' property.",
            "enum": [
              "contain",
              "cover",
              "fill",
              "none",
              "scaleDown"
            ],
            "default": "fill"
          },
          "variant": {
            "type": "string",
            "description": "A hint for the image size and style.",
            "enum": [
              "icon",
              "avatar",
              "smallFeature",
              "mediumFeature",
              "largeFeature",
              "header"
            ],
            "default": "mediumFeature"
          }
        },
        "required": [
          "id",
          "component",
          "url"
        ],
        "additionalProperties": false
      },
      "Icon": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "accessibility": {
            "$ref": "common_types.json#/$defs/AccessibilityAttributes"
          },
          "weight": {
            "type": "number",
            "description": "The relative weight of this component within a Row or Column. This is similar to the CSS 'flex-grow' property. Note: this may ONLY be set when the component is a direct descendant of a Row or Column."
          },
          "component": {
            "const": "Icon"
          },
          "name": {
            "description": "The name of the icon to display.",
            "oneOf": [
              {
                "type": "string",
                "enum": [
                  "accountCircle",
                  "add",
                  "arrowBack",
                  "arrowForward",
                  "attachFile",
                  "calendarToday",
                  "call",
                  "camera",
                  "check",
                  "close",
                  "delete",
                  "download",
                  "edit",
                  "event",
                  "error",
                  "fastForward",
                  "favorite",
                  "favoriteOff",
                  "folder",
                  "help",
                  "home",
                  "info",
                  "locationOn",
                  "lock",
                  "lockOpen",
                  "mail",
                  "menu",
                  "moreVert",
                  "moreHoriz",
                  "notificationsOff",
                  "notifications",
                  "pause",
                  "payment",
                  "person",
                  "phone",
                  "photo",
                  "play",
                  "print",
                  "refresh",
                  "rewind",
                  "search",
                  "send",
                  "settings",
                  "share",
                  "shoppingCart",
                  "skipNext",
                  "skipPrevious",
                  "star",
                  "starHalf",
                  "starOff",
                  "stop",
                  "upload",
                  "visibility",
                  "visibilityOff",
                  "volumeDown",
                  "volumeMute",
                  "volumeOff",
                  "volumeUp",
                  "warning"
                ]
              },
              {
                "type": "object",
                "properties": {
                  "svgPath": {
                    "type": "string"
                  }
                },
                "required": [
                  "svgPath"
                ],
                "additionalProperties": false
              },
              {
                "$ref": "common_types.json#/$defs/DataBinding"
              }
            ]
          }
        },
        "required": [
          "id",
          "component",
          "name"
        ],
        "additionalProperties": false
      },
      "Video": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "accessibility": {
            "$ref": "common_types.json#/$defs/AccessibilityAttributes"
          },
          "weight": {
            "type": "number",
            "description": "The relative weight of this component within a Row or Column. This is similar to the CSS 'flex-grow' property. Note: this may ONLY be set when the component is a direct descendant of a Row or Column."
          },
          "component": {
            "const": "Video"
          },
          "url": {
            "$ref": "common_types.json#/$defs/DynamicString",
            "description": "The URL of the video to display."
          }
        },
        "required": [
          "id",
          "component",
          "url"
        ],
        "additionalProperties": false
      },
      "AudioPlayer": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "accessibility": {
            "$ref": "common_types.json#/$defs/AccessibilityAttributes"
          },
          "weight": {
            "type": "number",
            "description": "The relative weight of this component within a Row or Column. This is similar to the CSS 'flex-grow' property. Note: this may ONLY be set when the component is a direct descendant of a Row or Column."
          },
          "component": {
            "const": "AudioPlayer"
          },
          "url": {
            "$ref": "common_types.json#/$defs/DynamicString",
            "description": "The URL of the audio to be played."
          },
          "description": {
            "description": "A description of the audio, such as a title or summary.",
            "$ref": "common_types.json#/$defs/DynamicString"
          }
        },
        "required": [
          "id",
          "component",
          "url"
        ],
        "additionalProperties": false
      },
      "Row": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "accessibility": {
            "$ref": "common_types.json#/$defs/AccessibilityAttributes"
          },
          "weight": {
            "type": "number",
            "description": "The relative weight of this component within a Row or Column. This is similar to the CSS 'flex-grow' property. Note: this may ONLY be set when the component is a direct descendant of a Row or Column."
          },
          "component": {
            "const": "Row"
          },
          "children": {
            "description": "Defines the children. Use an array of strings for a fixed set of children, or a template object to generate children from a data list. Children cannot be defined inline, they must be referred to by ID.",
            "$ref": "common_types.json#/$defs/ChildList"
          },
          "justify": {
            "type": "string",
            "description": "Defines the arrangement of children along the main axis (horizontally). Use 'spaceBetween' to push items to the edges, or 'start'/'end'/'center' to pack them together.",
            "enum": [
              "center",
              "end",
              "spaceAround",
              "spaceBetween",
              "spaceEvenly",
              "start",
              "stretch"
            ],
            "default": "start"
          },
          "align": {
            "type": "string",
            "description": "Defines the alignment of children along the cross axis (vertically). This is similar to the CSS 'align-items' property, but uses camelCase values (e.g., 'start').",
            "enum": [
              "start",
              "center",
              "end",
              "stretch"
            ],
            "default": "stretch"
          }
        },
        "required": [
          "id",
          "component",
          "children"
        ],
        "additionalProperties": false
      },
      "Column": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "accessibility": {
            "$ref": "common_types.json#/$defs/AccessibilityAttributes"
          },
          "weight": {
            "type": "number",
            "description": "The relative weight of this component within a Row or Column. This is similar to the CSS 'flex-grow' property. Note: this may ONLY be set when the component is a direct descendant of a Row or Column."
          },
          "component": {
            "const": "Column"
          },
          "children": {
            "description": "Defines the children. Use an array of strings for a fixed set of children, or a template object to generate children from a data list. Children cannot be defined inline, they must be referred to by ID.",
            "$ref": "common_types.json#/$defs/ChildList"
          },
          "justify": {
            "type": "string",
            "description": "Defines the arrangement of children along the main axis (vertically). Use 'spaceBetween' to push items to the edges (e.g. header at top, footer at bottom), or 'start'/'end'/'center' to pack them together.",
            "enum": [
              "start",
              "center",
              "end",
              "spaceBetween",
              "spaceAround",
              "spaceEvenly",
              "stretch"
            ],
            "default": "start"
          },
          "align": {
            "type": "string",
            "description": "Defines the alignment of children along the cross axis (horizontally). This is similar to the CSS 'align-items' property.",
            "enum": [
              "center",
              "end",
              "start",
              "stretch"
            ],
            "default": "stretch"
          }
        },
        "required": [
          "id",
          "component",
          "children"
        ],
        "additionalProperties": false
      },
      "List": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "accessibility": {
            "$ref": "common_types.json#/$defs/AccessibilityAttributes"
          },
          "weight": {
            "type": "number",
            "description": "The relative weight of this component within a Row or Column. This is similar to the CSS 'flex-grow' property. Note: this may ONLY be set when the component is a direct descendant of a Row or Column."
          },
          "component": {
            "const": "List"
          },
          "children": {
            "description": "Defines the children. Use an array of strings for a fixed set of children, or a template object to generate children from a data list.",
            "$ref": "common_types.json#/$defs/ChildList"
          },
          "direction": {
            "type": "string",
            "description": "The direction in which the list items are laid out.",
            "enum": [
              "vertical",
              "horizontal"
            ],
            "default": "vertical"
          },
          "align": {
            "type": "string",
            "description": "Defines the alignment of children along the cross axis.",
            "enum": [
              "start",
              "center",
              "end",
              "stretch"
            ],
            "default": "stretch"
          }
        },
        "required": [
          "id",
          "component",
          "children"
        ],
        "additionalProperties": false
      },
      "Card": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "accessibility": {
            "$ref": "common_types.json#/$defs/AccessibilityAttributes"
          },
          "weight": {
            "type": "number",
            "description": "The relative weight of this component within a Row or Column. This is similar to the CSS 'flex-grow' property. Note: this may ONLY be set when the component is a direct descendant of a Row or Column."
          },
          "component": {
            "const": "Card"
          },
          "child": {
            "$ref": "common_types.json#/$defs/ComponentId",
            "description": "The ID of the single child component to be rendered inside the card. To display multiple elements, you MUST wrap them in a layout component (like Column or Row) and pass that container's ID here. Do NOT pass multiple IDs or a non-existent ID."
          }
        },
        "required": [
          "id",
          "component",
          "child"
        ],
        "additionalProperties": false
      },
      "Tabs": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "accessibility": {
            "$ref": "common_types.json#/$defs/AccessibilityAttributes"
          },
          "weight": {
            "type": "number",
            "description": "The relative weight of this component within a Row or Column. This is similar to the CSS 'flex-grow' property. Note: this may ONLY be set when the component is a direct descendant of a Row or Column."
          },
          "component": {
            "const": "Tabs"
          },
          "tabs": {
            "type": "array",
            "description": "An array of objects, where each object defines a tab with a title and a child component.",
            "minItems": 1,
            "items": {
              "type": "object",
              "properties": {
                "title": {
                  "description": "The tab title.",
                  "$ref": "common_types.json#/$defs/DynamicString"
                },
                "child": {
                  "$ref": "common_types.json#/$defs/ComponentId",
                  "description": "The ID of the child component."
                }
              },
              "required": [
                "title",
                "child"
              ],
              "additionalProperties": false
            }
          }
        },
        "required": [
          "id",
          "component",
          "tabs"
        ],
        "additionalProperties": false
      },
      "Modal": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "accessibility": {
            "$ref": "common_types.json#/$defs/AccessibilityAttributes"
          },
          "weight": {
            "type": "number",
            "description": "The relative weight of this component within a Row or Column. This is similar to the CSS 'flex-grow' property. Note: this may ONLY be set when the component is a direct descendant of a Row or Column."
          },
          "component": {
            "const": "Modal"
          },
          "trigger": {
            "$ref": "common_types.json#/$defs/ComponentId",
            "description": "The ID of the component that opens the modal when interacted with (e.g., a button)."
          },
          "content": {
            "$ref": "common_types.json#/$defs/ComponentId",
            "description": "The ID of the component to be displayed inside the modal."
          }
        },
        "required": [
          "id",
          "component",
          "trigger",
          "content"
        ],
        "additionalProperties": false
      },
      "Divider": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "accessibility": {
            "$ref": "common_types.json#/$defs/AccessibilityAttributes"
          },
          "weight": {
            "type": "number",
            "description": "The relative weight of this component within a Row or Column. This is similar to the CSS 'flex-grow' property. Note: this may ONLY be set when the component is a direct descendant of a Row or Column."
          },
          "component": {
            "const": "Divider"
          },
          "axis": {
            "type": "string",
            "description": "The orientation of the divider.",
            "enum": [
              "horizontal",
              "vertical"
            ],
            "default": "horizontal"
          }
        },
        "required": [
          "id",
          "component"
        ],
        "additionalProperties": false
      },
      "Button": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "accessibility": {
            "$ref": "common_types.json#/$defs/AccessibilityAttributes"
          },
          "weight": {
            "type": "number",
            "description": "The relative weight of this component within a Row or Column. This is similar to the CSS 'flex-grow' property. Note: this may ONLY be set when the component is a direct descendant of a Row or Column."
          },
          "checks": {
            "type": "array",
            "description": "A list of checks to perform. These are function calls that must return a boolean indicating validity.",
            "items": {
              "$ref": "common_types.json#/$defs/CheckRule"
            }
          },
          "component": {
            "const": "Button"
          },
          "child": {
            "$ref": "common_types.json#/$defs/ComponentId",
            "description": "The ID of the child component. Use a 'Text' component for a labeled button. Only use an 'Icon' if the requirements explicitly ask for an icon-only button."
          },
          "variant": {
            "type": "string",
            "description": "A hint for the button style. If omitted, a default button style is used. 'primary' indicates this is the main call-to-action button. 'borderless' means the button has no visual border or background, making its child content appear like a clickable link.",
            "enum": [
              "default",
              "primary",
              "borderless"
            ],
            "default": "default"
          },
          "action": {
            "$ref": "common_types.json#/$defs/Action"
          }
        },
        "required": [
          "id",
          "component",
          "child",
          "action"
        ],
        "additionalProperties": false,
        "allOf": [
          {
            "$ref": "common_types.json#/$defs/Checkable"
          }
        ]
      },
      "TextField": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "accessibility": {
            "$ref": "common_types.json#/$defs/AccessibilityAttributes"
          },
          "weight": {
            "type": "number",
            "description": "The relative weight of this component within a Row or Column. This is similar to the CSS 'flex-grow' property. Note: this may ONLY be set when the component is a direct descendant of a Row or Column."
          },
          "checks": {
            "type": "array",
            "description": "A list of checks to perform. These are function calls that must return a boolean indicating validity.",
            "items": {
              "$ref": "common_types.json#/$defs/CheckRule"
            }
          },
          "component": {
            "const": "TextField"
          },
          "label": {
            "$ref": "common_types.json#/$defs/DynamicString",
            "description": "The text label for the input field."
          },
          "value": {
            "$ref": "common_types.json#/$defs/DynamicString",
            "description": "The value of the text field."
          },
          "variant": {
            "type": "string",
            "description": "The type of input field to display.",
            "enum": [
              "longText",
              "number",
              "shortText",
              "obscured"
            ],
            "default": "shortText"
          },
          "validationRegexp": {
            "type": "string",
            "description": "A regular expression used for client-side validation of the input."
          }
        },
        "required": [
          "id",
          "component",
          "label"
        ],
        "additionalProperties": false,
        "allOf": [
          {
            "$ref": "common_types.json#/$defs/Checkable"
          }
        ]
      },
      "CheckBox": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "accessibility": {
            "$ref": "common_types.json#/$defs/AccessibilityAttributes"
          },
          "weight": {
            "type": "number",
            "description": "The relative weight of this component within a Row or Column. This is similar to the CSS 'flex-grow' property. Note: this may ONLY be set when the component is a direct descendant of a Row or Column."
          },
          "checks": {
            "type": "array",
            "description": "A list of checks to perform. These are function calls that must return a boolean indicating validity.",
            "items": {
              "$ref": "common_types.json#/$defs/CheckRule"
            }
          },
          "component": {
            "const": "CheckBox"
          },
          "label": {
            "$ref": "common_types.json#/$defs/DynamicString",
            "description": "The text to display next to the checkbox."
          },
          "value": {
            "$ref": "common_types.json#/$defs/DynamicBoolean",
            "description": "The current state of the checkbox (true for checked, false for unchecked)."
          }
        },
        "required": [
          "id",
          "component",
          "label",
          "value"
        ],
        "additionalProperties": false,
        "allOf": [
          {
            "$ref": "common_types.json#/$defs/Checkable"
          }
        ]
      },
      "ChoicePicker": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "accessibility": {
            "$ref": "common_types.json#/$defs/AccessibilityAttributes"
          },
          "weight": {
            "type": "number",
            "description": "The relative weight of this component within a Row or Column. This is similar to the CSS 'flex-grow' property. Note: this may ONLY be set when the component is a direct descendant of a Row or Column."
          },
          "checks": {
            "type": "array",
            "description": "A list of checks to perform. These are function calls that must return a boolean indicating validity.",
            "items": {
              "$ref": "common_types.json#/$defs/CheckRule"
            }
          },
          "component": {
            "const": "ChoicePicker"
          },
          "label": {
            "$ref": "common_types.json#/$defs/DynamicString",
            "description": "The label for the group of options."
          },
          "variant": {
            "type": "string",
            "description": "A hint for how the choice picker should be displayed and behave.",
            "enum": [
              "multipleSelection",
              "mutuallyExclusive"
            ],
            "default": "mutuallyExclusive"
          },
          "options": {
            "type": "array",
            "description": "The list of available options to choose from.",
            "items": {
              "type": "object",
              "properties": {
                "label": {
                  "description": "The text to display for this option.",
                  "$ref": "common_types.json#/$defs/DynamicString"
                },
                "value": {
                  "type": "string",
                  "description": "The stable value associated with this option."
                }
              },
              "required": [
                "label",
                "value"
              ],
              "additionalProperties": false
            }
          },
          "value": {
            "$ref": "common_types.json#/$defs/DynamicStringList",
            "description": "The list of currently selected values. This should be bound to a string array in the data model."
          },
          "displayStyle": {
            "type": "string",
            "description": "The display style of the component.",
            "enum": [
              "checkbox",
              "chips"
            ],
            "default": "checkbox"
          },
          "filterable": {
            "type": "boolean",
            "description": "If true, displays a search input to filter the options.",
            "default": false
          }
        },
        "required": [
          "id",
          "component",
          "options",
          "value"
        ],
        "additionalProperties": false,
        "allOf": [
          {
            "$ref": "common_types.json#/$defs/Checkable"
          }
        ]
      },
      "Slider": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "accessibility": {
            "$ref": "common_types.json#/$defs/AccessibilityAttributes"
          },
          "weight": {
            "type": "number",
            "description": "The relative weight of this component within a Row or Column. This is similar to the CSS 'flex-grow' property. Note: this may ONLY be set when the component is a direct descendant of a Row or Column."
          },
          "checks": {
            "type": "array",
            "description": "A list of checks to perform. These are function calls that must return a boolean indicating validity.",
            "items": {
              "$ref": "common_types.json#/$defs/CheckRule"
            }
          },
          "component": {
            "const": "Slider"
          },
          "label": {
            "$ref": "common_types.json#/$defs/DynamicString",
            "description": "The label for the slider."
          },
          "min": {
            "type": "number",
            "description": "The minimum value of the slider.",
            "default": 0
          },
          "max": {
            "type": "number",
            "description": "The maximum value of the slider."
          },
          "value": {
            "$ref": "common_types.json#/$defs/DynamicNumber",
            "description": "The current value of the slider."
          }
        },
        "required": [
          "id",
          "component",
          "value",
          "max"
        ],
        "additionalProperties": false,
        "allOf": [
          {
            "$ref": "common_types.json#/$defs/Checkable"
          }
        ]
      },
      "DateTimeInput": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "accessibility": {
            "$ref": "common_types.json#/$defs/AccessibilityAttributes"
          },
          "weight": {
            "type": "number",
            "description": "The relative weight of this component within a Row or Column. This is similar to the CSS 'flex-grow' property. Note: this may ONLY be set when the component is a direct descendant of a Row or Column."
          },
          "checks": {
            "type": "array",
            "description": "A list of checks to perform. These are function calls that must return a boolean indicating validity.",
            "items": {
              "$ref": "common_types.json#/$defs/CheckRule"
            }
          },
          "component": {
            "const": "DateTimeInput"
          },
          "value": {
            "$ref": "common_types.json#/$defs/DynamicString",
            "description": "The selected date and/or time value in ISO 8601 format. If not yet set, initialize with an empty string."
          },
          "enableDate": {
            "type": "boolean",
            "description": "If true, allows the user to select a date.",
            "default": false
          },
          "enableTime": {
            "type": "boolean",
            "description": "If true, allows the user to select a time.",
            "default": false
          },
          "min": {
            "allOf": [
              {
                "$ref": "common_types.json#/$defs/DynamicString"
              },
              {
                "if": {
                  "type": "string"
                },
                "then": {
                  "oneOf": [
                    {
                      "format": "date"
                    },
                    {
                      "format": "time"
                    },
                    {
                      "format": "date-time"
                    }
                  ]
                }
              }
            ],
            "description": "The minimum allowed date/time in ISO 8601 format."
          },
          "max": {
            "allOf": [
              {
                "$ref": "common_types.json#/$defs/DynamicString"
              },
              {
                "if": {
                  "type": "string"
                },
                "then": {
                  "oneOf": [
                    {
                      "format": "date"
                    },
                    {
                      "format": "time"
                    },
                    {
                      "format": "date-time"
                    }
                  ]
                }
              }
            ],
            "description": "The maximum allowed date/time in ISO 8601 format."
          },
          "label": {
            "$ref": "common_types.json#/$defs/DynamicString",
            "description": "The text label for the input field."
          }
        },
        "required": [
          "id",
          "component",
          "value"
        ],
        "additionalProperties": false,
        "allOf": [
          {
            "$ref": "common_types.json#/$defs/Checkable"
          }
        ]
      }
    },
    "functions": {
      "required": {
        "type": "object",
        "description": "Checks that the value is not null, undefined, or empty.",
        "properties": {
          "call": {
            "const": "required"
          },
          "args": {
            "type": "object",
            "properties": {
              "value": {
                "description": "The value to check."
              }
            },
            "required": [
              "value"
            ],
            "additionalProperties": false
          },
          "returnType": {
            "const": "boolean"
          }
        },
        "required": [
          "call",
          "args"
        ],
        "unevaluatedProperties": false
      },
      "regex": {
        "type": "object",
        "description": "Checks that the value matches a regular expression string.",
        "properties": {
          "call": {
            "const": "regex"
          },
          "args": {
            "type": "object",
            "properties": {
              "value": {
                "$ref": "common_types.json#/$defs/DynamicString"
              },
              "pattern": {
                "type": "string",
                "description": "The regex pattern to match against."
              }
            },
            "required": [
              "value",
              "pattern"
            ],
            "unevaluatedProperties": false
          },
          "returnType": {
            "const": "boolean"
          }
        },
        "required": [
          "call",
          "args"
        ],
        "unevaluatedProperties": false
      },
      "length": {
        "type": "object",
        "description": "Checks string length constraints.",
        "properties": {
          "call": {
            "const": "length"
          },
          "args": {
            "type": "object",
            "properties": {
              "value": {
                "$ref": "common_types.json#/$defs/DynamicString"
              },
              "min": {
                "type": "integer",
                "minimum": 0,
                "description": "The minimum allowed length."
              },
              "max": {
                "type": "integer",
                "minimum": 0,
                "description": "The maximum allowed length."
              }
            },
            "required": [
              "value"
            ],
            "anyOf": [
              {
                "required": [
                  "min"
                ]
              },
              {
                "required": [
                  "max"
                ]
              }
            ],
            "unevaluatedProperties": false
          },
          "returnType": {
            "const": "boolean"
          }
        },
        "required": [
          "call",
          "args"
        ],
        "unevaluatedProperties": false
      },
      "numeric": {
        "type": "object",
        "description": "Checks numeric range constraints.",
        "properties": {
          "call": {
            "const": "numeric"
          },
          "args": {
            "type": "object",
            "properties": {
              "value": {
                "$ref": "common_types.json#/$defs/DynamicNumber"
              },
              "min": {
                "type": "number",
                "description": "The minimum allowed value."
              },
              "max": {
                "type": "number",
                "description": "The maximum allowed value."
              }
            },
            "required": [
              "value"
            ],
            "anyOf": [
              {
                "required": [
                  "min"
                ]
              },
              {
                "required": [
                  "max"
                ]
              }
            ],
            "unevaluatedProperties": false
          },
          "returnType": {
            "const": "boolean"
          }
        },
        "required": [
          "call",
          "args"
        ],
        "unevaluatedProperties": false
      },
      "email": {
        "type": "object",
        "description": "Checks that the value is a valid email address.",
        "properties": {
          "call": {
            "const": "email"
          },
          "args": {
            "type": "object",
            "properties": {
              "value": {
                "$ref": "common_types.json#/$defs/DynamicString"
              }
            },
            "required": [
              "value"
            ],
            "unevaluatedProperties": false
          },
          "returnType": {
            "const": "boolean"
          }
        },
        "required": [
          "call",
          "args"
        ],
        "unevaluatedProperties": false
      },
      "formatString": {
        "type": "object",
        "description": "Performs string interpolation of data model values and other functions in the catalog functions list and returns the resulting string. The value string can contain interpolated expressions in the `${expression}` format. Supported expression types include: JSON Pointer paths to the data model (e.g., `${/absolute/path}` or `${relative/path}`), and client-side function calls (e.g., `${now()}`). Function arguments must be named (e.g., `${formatDate(value:${/currentDate}, format:'MM-dd')}`). To include a literal `${` sequence, escape it as `\\${`.",
        "properties": {
          "call": {
            "const": "formatString"
          },
          "args": {
            "type": "object",
            "properties": {
              "value": {
                "$ref": "common_types.json#/$defs/DynamicString"
              }
            },
            "required": [
              "value"
            ],
            "unevaluatedProperties": false
          },
          "returnType": {
            "const": "string"
          }
        },
        "required": [
          "call",
          "args"
        ],
        "unevaluatedProperties": false
      },
      "formatNumber": {
        "type": "object",
        "description": "Formats a number with the specified grouping and decimal precision.",
        "properties": {
          "call": {
            "const": "formatNumber"
          },
          "args": {
            "type": "object",
            "properties": {
              "value": {
                "$ref": "common_types.json#/$defs/DynamicNumber",
                "description": "The number to format."
              },
              "decimals": {
                "$ref": "common_types.json#/$defs/DynamicNumber",
                "description": "Optional. The number of decimal places to show. Defaults to 0 or 2 depending on locale."
              },
              "grouping": {
                "$ref": "common_types.json#/$defs/DynamicBoolean",
                "description": "Optional. If true, uses locale-specific grouping separators (e.g. '1,000'). If false, returns raw digits (e.g. '1000'). Defaults to true."
              }
            },
            "required": [
              "value"
            ],
            "unevaluatedProperties": false
          },
          "returnType": {
            "const": "string"
          }
        },
        "required": [
          "call",
          "args"
        ],
        "unevaluatedProperties": false
      },
      "formatCurrency": {
        "type": "object",
        "description": "Formats a number as a currency string.",
        "properties": {
          "call": {
            "const": "formatCurrency"
          },
          "args": {
            "type": "object",
            "properties": {
              "value": {
                "$ref": "common_types.json#/$defs/DynamicNumber",
                "description": "The monetary amount."
              },
              "currency": {
                "$ref": "common_types.json#/$defs/DynamicString",
                "description": "The ISO 4217 currency code (e.g., 'USD', 'EUR')."
              },
              "decimals": {
                "$ref": "common_types.json#/$defs/DynamicNumber",
                "description": "Optional. The number of decimal places to show. Defaults to 0 or 2 depending on locale."
              },
              "grouping": {
                "$ref": "common_types.json#/$defs/DynamicBoolean",
                "description": "Optional. If true, uses locale-specific grouping separators (e.g. '1,000'). If false, returns raw digits (e.g. '1000'). Defaults to true."
              }
            },
            "required": [
              "currency",
              "value"
            ],
            "unevaluatedProperties": false
          },
          "returnType": {
            "const": "string"
          }
        },
        "required": [
          "call",
          "args"
        ],
        "unevaluatedProperties": false
      },
      "formatDate": {
        "type": "object",
        "description": "Formats a timestamp into a string using a pattern.",
        "properties": {
          "call": {
            "const": "formatDate"
          },
          "args": {
            "type": "object",
            "properties": {
              "value": {
                "$ref": "common_types.json#/$defs/DynamicValue",
                "description": "The date to format."
              },
              "format": {
                "$ref": "common_types.json#/$defs/DynamicString",
                "description": "A Unicode TR35 date pattern string.\n\nToken Reference:\n- Year: 'yy' (26), 'yyyy' (2026)\n- Month: 'M' (1), 'MM' (01), 'MMM' (Jan), 'MMMM' (January)\n- Day: 'd' (1), 'dd' (01), 'E' (Tue), 'EEEE' (Tuesday)\n- Hour (12h): 'h' (1-12), 'hh' (01-12) - requires 'a' for AM/PM\n- Hour (24h): 'H' (0-23), 'HH' (00-23) - Military Time\n- Minute: 'mm' (00-59)\n- Second: 'ss' (00-59)\n- Period: 'a' (AM/PM)\n\nExamples:\n- 'MMM dd, yyyy' -> 'Jan 16, 2026'\n- 'HH:mm' -> '14:30' (Military)\n- 'h:mm a' -> '2:30 PM'\n- 'EEEE, d MMMM' -> 'Friday, 16 January'"
              }
            },
            "required": [
              "format",
              "value"
            ],
            "unevaluatedProperties": false
          },
          "returnType": {
            "const": "string"
          }
        },
        "required": [
          "call",
          "args"
        ],
        "unevaluatedProperties": false
      },
      "pluralize": {
        "type": "object",
        "description": "Returns a localized string based on the Common Locale Data Repository (CLDR) plural category of the count (zero, one, two, few, many, other). Requires an 'other' fallback. For English, just use 'one' and 'other'.",
        "properties": {
          "call": {
            "const": "pluralize"
          },
          "args": {
            "type": "object",
            "properties": {
              "value": {
                "$ref": "common_types.json#/$defs/DynamicNumber",
                "description": "The numeric value used to determine the plural category."
              },
              "zero": {
                "$ref": "common_types.json#/$defs/DynamicString",
                "description": "String for the 'zero' category (e.g., 0 items)."
              },
              "one": {
                "$ref": "common_types.json#/$defs/DynamicString",
                "description": "String for the 'one' category (e.g., 1 item)."
              },
              "two": {
                "$ref": "common_types.json#/$defs/DynamicString",
                "description": "String for the 'two' category (used in Arabic, Welsh, etc.)."
              },
              "few": {
                "$ref": "common_types.json#/$defs/DynamicString",
                "description": "String for the 'few' category (e.g., small groups in Slavic languages)."
              },
              "many": {
                "$ref": "common_types.json#/$defs/DynamicString",
                "description": "String for the 'many' category (e.g., large groups in various languages)."
              },
              "other": {
                "$ref": "common_types.json#/$defs/DynamicString",
                "description": "The default/fallback string (used for general plural cases)."
              }
            },
            "required": [
              "value",
              "other"
            ],
            "unevaluatedProperties": false
          },
          "returnType": {
            "const": "string"
          }
        },
        "required": [
          "call",
          "args"
        ],
        "unevaluatedProperties": false
      },
      "openUrl": {
        "type": "object",
        "description": "Opens the specified URL in a browser or handler. This function has no return value.",
        "properties": {
          "call": {
            "const": "openUrl"
          },
          "args": {
            "type": "object",
            "properties": {
              "url": {
                "type": "string",
                "format": "uri",
                "description": "The URL to open."
              }
            },
            "required": [
              "url"
            ],
            "additionalProperties": false
          },
          "returnType": {
            "const": "void"
          }
        },
        "required": [
          "call",
          "args"
        ],
        "unevaluatedProperties": false
      },
      "and": {
        "type": "object",
        "description": "Performs a logical AND operation on a list of boolean values.",
        "properties": {
          "call": {
            "const": "and"
          },
          "args": {
            "type": "object",
            "properties": {
              "values": {
                "type": "array",
                "description": "The list of boolean values to evaluate.",
                "items": {
                  "$ref": "common_types.json#/$defs/DynamicBoolean"
                },
                "minItems": 2
              }
            },
            "required": [
              "values"
            ],
            "unevaluatedProperties": false
          },
          "returnType": {
            "const": "boolean"
          }
        },
        "required": [
          "call",
          "args"
        ],
        "unevaluatedProperties": false
      },
      "or": {
        "type": "object",
        "description": "Performs a logical OR operation on a list of boolean values.",
        "properties": {
          "call": {
            "const": "or"
          },
          "args": {
            "type": "object",
            "properties": {
              "values": {
                "type": "array",
                "description": "The list of boolean values to evaluate.",
                "items": {
                  "$ref": "common_types.json#/$defs/DynamicBoolean"
                },
                "minItems": 2
              }
            },
            "required": [
              "values"
            ],
            "unevaluatedProperties": false
          },
          "returnType": {
            "const": "boolean"
          }
        },
        "required": [
          "call",
          "args"
        ],
        "unevaluatedProperties": false
      },
      "not": {
        "type": "object",
        "description": "Performs a logical NOT operation on a boolean value.",
        "properties": {
          "call": {
            "const": "not"
          },
          "args": {
            "type": "object",
            "properties": {
              "value": {
                "$ref": "common_types.json#/$defs/DynamicBoolean",
                "description": "The boolean value to negate."
              }
            },
            "required": [
              "value"
            ],
            "unevaluatedProperties": false
          },
          "returnType": {
            "const": "boolean"
          }
        },
        "required": [
          "call",
          "args"
        ],
        "unevaluatedProperties": false
      }
    },
    "$defs": {
      "CatalogComponentCommon": {
        "type": "object",
        "properties": {
          "weight": {
            "type": "number",
            "description": "The relative weight of this component within a Row or Column. This is similar to the CSS 'flex-grow' property. Note: this may ONLY be set when the component is a direct descendant of a Row or Column."
          }
        }
      },
      "theme": {
        "type": "object",
        "properties": {
          "primaryColor": {
            "type": "string",
            "description": "The primary brand color used for highlights (e.g., primary buttons, active borders). Renderers may generate variants of this color for different contexts. Format: Hexadecimal code (e.g., '#00BFFF').",
            "pattern": "^#[0-9a-fA-F]{6}$"
          },
          "iconUrl": {
            "type": "string",
            "format": "uri",
            "description": "A URL for an image that identifies the agent or tool associated with the surface."
          },
          "agentDisplayName": {
            "type": "string",
            "description": "Text to be displayed next to the surface to identify the agent or tool that created it."
          }
        },
        "additionalProperties": true
      },
      "anyComponent": {
        "oneOf": [
          {
            "$ref": "#/components/Text"
          },
          {
            "$ref": "#/components/Image"
          },
          {
            "$ref": "#/components/Icon"
          },
          {
            "$ref": "#/components/Video"
          },
          {
            "$ref": "#/components/AudioPlayer"
          },
          {
            "$ref": "#/components/Row"
          },
          {
            "$ref": "#/components/Column"
          },
          {
            "$ref": "#/components/List"
          },
          {
            "$ref": "#/components/Card"
          },
          {
            "$ref": "#/components/Tabs"
          },
          {
            "$ref": "#/components/Modal"
          },
          {
            "$ref": "#/components/Divider"
          },
          {
            "$ref": "#/components/Button"
          },
          {
            "$ref": "#/components/TextField"
          },
          {
            "$ref": "#/components/CheckBox"
          },
          {
            "$ref": "#/components/ChoicePicker"
          },
          {
            "$ref": "#/components/Slider"
          },
          {
            "$ref": "#/components/DateTimeInput"
          }
        ],
        "discriminator": {
          "propertyName": "component"
        }
      },
      "anyFunction": {
        "oneOf": [
          {
            "$ref": "#/functions/required"
          },
          {
            "$ref": "#/functions/regex"
          },
          {
            "$ref": "#/functions/length"
          },
          {
            "$ref": "#/functions/numeric"
          },
          {
            "$ref": "#/functions/email"
          },
          {
            "$ref": "#/functions/formatString"
          },
          {
            "$ref": "#/functions/formatNumber"
          },
          {
            "$ref": "#/functions/formatCurrency"
          },
          {
            "$ref": "#/functions/formatDate"
          },
          {
            "$ref": "#/functions/pluralize"
          },
          {
            "$ref": "#/functions/openUrl"
          },
          {
            "$ref": "#/functions/and"
          },
          {
            "$ref": "#/functions/or"
          },
          {
            "$ref": "#/functions/not"
          }
        ]
      },
      "commonTypes": {
        "$id": "common_types.json",
        "$defs": {
          "ComponentId": {
            "type": "string",
            "description": "The unique identifier for a component, used for both definitions and references within the same surface."
          },
          "AccessibilityAttributes": {
            "type": "object",
            "description": "Attributes to enhance accessibility when using assistive technologies like screen readers.",
            "properties": {
              "label": {
                "$ref": "common_types.json#/$defs/DynamicString",
                "description": "A short string, typically 1 to 3 words, used by assistive technologies to convey the purpose or intent of an element. For example, an input field might have an accessible label of 'User ID' or a button might be labeled 'Submit'."
              },
              "description": {
                "$ref": "common_types.json#/$defs/DynamicString",
                "description": "Additional information provided by assistive technologies about an element such as instructions, format requirements, or result of an action. For example, a mute button might have a label of 'Mute' and a description of 'Silences notifications about this conversation'."
              }
            }
          },
          "ComponentCommon": {
            "type": "object",
            "properties": {
              "id": {
                "$ref": "common_types.json#/$defs/ComponentId"
              },
              "accessibility": {
                "$ref": "common_types.json#/$defs/AccessibilityAttributes"
              }
            },
            "required": [
              "id"
            ]
          },
          "ChildList": {
            "oneOf": [
              {
                "type": "array",
                "items": {
                  "$ref": "common_types.json#/$defs/ComponentId"
                },
                "description": "A static list of child component IDs."
              },
              {
                "type": "object",
                "description": "A template for generating a dynamic list of children from a data model list. The `componentId` is the component to use as a template.",
                "properties": {
                  "componentId": {
                    "$ref": "common_types.json#/$defs/ComponentId"
                  },
                  "path": {
                    "type": "string",
                    "description": "The path to the list of component property objects in the data model."
                  }
                },
                "required": [
                  "componentId",
                  "path"
                ],
                "additionalProperties": false
              }
            ]
          },
          "DataBinding": {
            "type": "object",
            "properties": {
              "path": {
                "type": "string",
                "description": "A JSON Pointer path to a value in the data model."
              }
            },
            "required": [
              "path"
            ],
            "additionalProperties": false
          },
          "DynamicValue": {
            "description": "A value that can be a literal, a path, or a function call returning any type.",
            "oneOf": [
              {
                "type": "string"
              },
              {
                "type": "number"
              },
              {
                "type": "boolean"
              },
              {
                "type": "array"
              },
              {
                "$ref": "common_types.json#/$defs/DataBinding"
              },
              {
                "$ref": "common_types.json#/$defs/FunctionCall"
              }
            ]
          },
          "DynamicString": {
            "description": "Represents a string",
            "oneOf": [
              {
                "type": "string"
              },
              {
                "$ref": "common_types.json#/$defs/DataBinding"
              },
              {
                "allOf": [
                  {
                    "$ref": "common_types.json#/$defs/FunctionCall"
                  },
                  {
                    "properties": {
                      "returnType": {
                        "const": "string"
                      }
                    }
                  }
                ]
              }
            ]
          },
          "DynamicNumber": {
            "description": "Represents a value that can be either a literal number, a path to a number in the data model, or a function call returning a number.",
            "oneOf": [
              {
                "type": "number"
              },
              {
                "$ref": "common_types.json#/$defs/DataBinding"
              },
              {
                "allOf": [
                  {
                    "$ref": "common_types.json#/$defs/FunctionCall"
                  },
                  {
                    "properties": {
                      "returnType": {
                        "const": "number"
                      }
                    }
                  }
                ]
              }
            ]
          },
          "DynamicBoolean": {
            "description": "A boolean value that can be a literal, a path, or a function call returning a boolean.",
            "oneOf": [
              {
                "type": "boolean"
              },
              {
                "$ref": "common_types.json#/$defs/DataBinding"
              },
              {
                "allOf": [
                  {
                    "$ref": "common_types.json#/$defs/FunctionCall"
                  },
                  {
                    "properties": {
                      "returnType": {
                        "const": "boolean"
                      }
                    }
                  }
                ]
              }
            ]
          },
          "DynamicStringList": {
            "description": "Represents a value that can be either a literal array of strings, a path to a string array in the data model, or a function call returning a string array.",
            "oneOf": [
              {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              {
                "$ref": "common_types.json#/$defs/DataBinding"
              },
              {
                "allOf": [
                  {
                    "$ref": "common_types.json#/$defs/FunctionCall"
                  },
                  {
                    "properties": {
                      "returnType": {
                        "const": "array"
                      }
                    }
                  }
                ]
              }
            ]
          },
          "FunctionCall": {
            "type": "object",
            "description": "Invokes a named function on the client.",
            "properties": {
              "call": {
                "type": "string",
                "description": "The name of the function to call."
              },
              "args": {
                "type": "object",
                "description": "Arguments passed to the function.",
                "additionalProperties": {
                  "anyOf": [
                    {
                      "$ref": "common_types.json#/$defs/DynamicValue"
                    },
                    {
                      "type": "object",
                      "description": "A literal object argument (e.g. configuration)."
                    }
                  ]
                }
              },
              "returnType": {
                "type": "string",
                "description": "The expected return type of the function call.",
                "enum": [
                  "string",
                  "number",
                  "boolean",
                  "array",
                  "object",
                  "any",
                  "void"
                ],
                "default": "boolean"
              }
            },
            "required": [
              "call"
            ],
            "oneOf": [
              {
                "$ref": "basic_functions.json#/$defs/anyFunction"
              }
            ]
          },
          "CheckRule": {
            "type": "object",
            "description": "A single validation rule applied to an input component.",
            "properties": {
              "condition": {
                "$ref": "common_types.json#/$defs/DynamicBoolean"
              },
              "message": {
                "type": "string",
                "description": "The error message to display if the check fails."
              }
            },
            "required": [
              "condition",
              "message"
            ],
            "additionalProperties": false
          },
          "Checkable": {
            "description": "Properties for components that support client-side checks.",
            "type": "object",
            "properties": {
              "checks": {
                "type": "array",
                "description": "A list of checks to perform. These are function calls that must return a boolean indicating validity.",
                "items": {
                  "$ref": "common_types.json#/$defs/CheckRule"
                }
              }
            }
          },
          "Action": {
            "description": "Defines an interaction handler that can either trigger a server-side event or execute a local client-side function.",
            "oneOf": [
              {
                "type": "object",
                "description": "Triggers a server-side event.",
                "properties": {
                  "event": {
                    "type": "object",
                    "description": "The event to dispatch to the server.",
                    "properties": {
                      "name": {
                        "type": "string",
                        "description": "The name of the action to be dispatched to the server."
                      },
                      "context": {
                        "type": "object",
                        "description": "A JSON object containing the key-value pairs for the action context. Values can be literals or paths. Use literal values unless the value must be dynamically bound to the data model. Do NOT use paths for static IDs.",
                        "additionalProperties": {
                          "$ref": "common_types.json#/$defs/DynamicValue"
                        }
                      }
                    },
                    "required": [
                      "name"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "event"
                ],
                "additionalProperties": false
              },
              {
                "type": "object",
                "description": "Executes a local client-side function.",
                "properties": {
                  "functionCall": {
                    "$ref": "common_types.json#/$defs/FunctionCall"
                  }
                },
                "required": [
                  "functionCall"
                ],
                "additionalProperties": false
              }
            ]
          }
        }
      },
      "basicFunctions": {
        "$id": "basic_functions.json",
        "$defs": {
          "required": {
            "type": "object",
            "description": "Checks that the value is not null, undefined, or empty.",
            "properties": {
              "call": {
                "const": "required"
              },
              "args": {
                "type": "object",
                "properties": {
                  "value": {
                    "description": "The value to check."
                  }
                },
                "required": [
                  "value"
                ],
                "additionalProperties": false
              },
              "returnType": {
                "const": "boolean"
              }
            },
            "required": [
              "call",
              "args"
            ],
            "unevaluatedProperties": false
          },
          "regex": {
            "type": "object",
            "description": "Checks that the value matches a regular expression string.",
            "properties": {
              "call": {
                "const": "regex"
              },
              "args": {
                "type": "object",
                "properties": {
                  "value": {
                    "$ref": "common_types.json#/$defs/DynamicString"
                  },
                  "pattern": {
                    "type": "string",
                    "description": "The regex pattern to match against."
                  }
                },
                "required": [
                  "value",
                  "pattern"
                ],
                "unevaluatedProperties": false
              },
              "returnType": {
                "const": "boolean"
              }
            },
            "required": [
              "call",
              "args"
            ],
            "unevaluatedProperties": false
          },
          "length": {
            "type": "object",
            "description": "Checks string length constraints.",
            "properties": {
              "call": {
                "const": "length"
              },
              "args": {
                "type": "object",
                "properties": {
                  "value": {
                    "$ref": "common_types.json#/$defs/DynamicString"
                  },
                  "min": {
                    "type": "integer",
                    "minimum": 0,
                    "description": "The minimum allowed length."
                  },
                  "max": {
                    "type": "integer",
                    "minimum": 0,
                    "description": "The maximum allowed length."
                  }
                },
                "required": [
                  "value"
                ],
                "anyOf": [
                  {
                    "required": [
                      "min"
                    ]
                  },
                  {
                    "required": [
                      "max"
                    ]
                  }
                ],
                "unevaluatedProperties": false
              },
              "returnType": {
                "const": "boolean"
              }
            },
            "required": [
              "call",
              "args"
            ],
            "unevaluatedProperties": false
          },
          "numeric": {
            "type": "object",
            "description": "Checks numeric range constraints.",
            "properties": {
              "call": {
                "const": "numeric"
              },
              "args": {
                "type": "object",
                "properties": {
                  "value": {
                    "$ref": "common_types.json#/$defs/DynamicNumber"
                  },
                  "min": {
                    "type": "number",
                    "description": "The minimum allowed value."
                  },
                  "max": {
                    "type": "number",
                    "description": "The maximum allowed value."
                  }
                },
                "required": [
                  "value"
                ],
                "anyOf": [
                  {
                    "required": [
                      "min"
                    ]
                  },
                  {
                    "required": [
                      "max"
                    ]
                  }
                ],
                "unevaluatedProperties": false
              },
              "returnType": {
                "const": "boolean"
              }
            },
            "required": [
              "call",
              "args"
            ],
            "unevaluatedProperties": false
          },
          "email": {
            "type": "object",
            "description": "Checks that the value is a valid email address.",
            "properties": {
              "call": {
                "const": "email"
              },
              "args": {
                "type": "object",
                "properties": {
                  "value": {
                    "$ref": "common_types.json#/$defs/DynamicString"
                  }
                },
                "required": [
                  "value"
                ],
                "unevaluatedProperties": false
              },
              "returnType": {
                "const": "boolean"
              }
            },
            "required": [
              "call",
              "args"
            ],
            "unevaluatedProperties": false
          },
          "formatString": {
            "type": "object",
            "description": "Performs string interpolation of data model values and other functions in the catalog functions list and returns the resulting string. The value string can contain interpolated expressions in the `${expression}` format. Supported expression types include: JSON Pointer paths to the data model (e.g., `${/absolute/path}` or `${relative/path}`), and client-side function calls (e.g., `${now()}`). Function arguments must be named (e.g., `${formatDate(value:${/currentDate}, format:'MM-dd')}`). To include a literal `${` sequence, escape it as `\\${`.",
            "properties": {
              "call": {
                "const": "formatString"
              },
              "args": {
                "type": "object",
                "properties": {
                  "value": {
                    "$ref": "common_types.json#/$defs/DynamicString"
                  }
                },
                "required": [
                  "value"
                ],
                "unevaluatedProperties": false
              },
              "returnType": {
                "const": "string"
              }
            },
            "required": [
              "call",
              "args"
            ],
            "unevaluatedProperties": false
          },
          "formatNumber": {
            "type": "object",
            "description": "Formats a number with the specified grouping and decimal precision.",
            "properties": {
              "call": {
                "const": "formatNumber"
              },
              "args": {
                "type": "object",
                "properties": {
                  "value": {
                    "$ref": "common_types.json#/$defs/DynamicNumber",
                    "description": "The number to format."
                  },
                  "decimals": {
                    "$ref": "common_types.json#/$defs/DynamicNumber",
                    "description": "Optional. The number of decimal places to show. Defaults to 0 or 2 depending on locale."
                  },
                  "grouping": {
                    "$ref": "common_types.json#/$defs/DynamicBoolean",
                    "description": "Optional. If true, uses locale-specific grouping separators (e.g. '1,000'). If false, returns raw digits (e.g. '1000'). Defaults to true."
                  }
                },
                "required": [
                  "value"
                ],
                "unevaluatedProperties": false
              },
              "returnType": {
                "const": "string"
              }
            },
            "required": [
              "call",
              "args"
            ],
            "unevaluatedProperties": false
          },
          "formatCurrency": {
            "type": "object",
            "description": "Formats a number as a currency string.",
            "properties": {
              "call": {
                "const": "formatCurrency"
              },
              "args": {
                "type": "object",
                "properties": {
                  "value": {
                    "$ref": "common_types.json#/$defs/DynamicNumber",
                    "description": "The monetary amount."
                  },
                  "currency": {
                    "$ref": "common_types.json#/$defs/DynamicString",
                    "description": "The ISO 4217 currency code (e.g., 'USD', 'EUR')."
                  },
                  "decimals": {
                    "$ref": "common_types.json#/$defs/DynamicNumber",
                    "description": "Optional. The number of decimal places to show. Defaults to 0 or 2 depending on locale."
                  },
                  "grouping": {
                    "$ref": "common_types.json#/$defs/DynamicBoolean",
                    "description": "Optional. If true, uses locale-specific grouping separators (e.g. '1,000'). If false, returns raw digits (e.g. '1000'). Defaults to true."
                  }
                },
                "required": [
                  "currency",
                  "value"
                ],
                "unevaluatedProperties": false
              },
              "returnType": {
                "const": "string"
              }
            },
            "required": [
              "call",
              "args"
            ],
            "unevaluatedProperties": false
          },
          "formatDate": {
            "type": "object",
            "description": "Formats a timestamp into a string using a pattern.",
            "properties": {
              "call": {
                "const": "formatDate"
              },
              "args": {
                "type": "object",
                "properties": {
                  "value": {
                    "$ref": "common_types.json#/$defs/DynamicValue",
                    "description": "The date to format."
                  },
                  "format": {
                    "$ref": "common_types.json#/$defs/DynamicString",
                    "description": "A Unicode TR35 date pattern string.\n\nToken Reference:\n- Year: 'yy' (26), 'yyyy' (2026)\n- Month: 'M' (1), 'MM' (01), 'MMM' (Jan), 'MMMM' (January)\n- Day: 'd' (1), 'dd' (01), 'E' (Tue), 'EEEE' (Tuesday)\n- Hour (12h): 'h' (1-12), 'hh' (01-12) - requires 'a' for AM/PM\n- Hour (24h): 'H' (0-23), 'HH' (00-23) - Military Time\n- Minute: 'mm' (00-59)\n- Second: 'ss' (00-59)\n- Period: 'a' (AM/PM)\n\nExamples:\n- 'MMM dd, yyyy' -> 'Jan 16, 2026'\n- 'HH:mm' -> '14:30' (Military)\n- 'h:mm a' -> '2:30 PM'\n- 'EEEE, d MMMM' -> 'Friday, 16 January'"
                  }
                },
                "required": [
                  "format",
                  "value"
                ],
                "unevaluatedProperties": false
              },
              "returnType": {
                "const": "string"
              }
            },
            "required": [
              "call",
              "args"
            ],
            "unevaluatedProperties": false
          },
          "pluralize": {
            "type": "object",
            "description": "Returns a localized string based on the Common Locale Data Repository (CLDR) plural category of the count (zero, one, two, few, many, other). Requires an 'other' fallback. For English, just use 'one' and 'other'.",
            "properties": {
              "call": {
                "const": "pluralize"
              },
              "args": {
                "type": "object",
                "properties": {
                  "value": {
                    "$ref": "common_types.json#/$defs/DynamicNumber",
                    "description": "The numeric value used to determine the plural category."
                  },
                  "zero": {
                    "$ref": "common_types.json#/$defs/DynamicString",
                    "description": "String for the 'zero' category (e.g., 0 items)."
                  },
                  "one": {
                    "$ref": "common_types.json#/$defs/DynamicString",
                    "description": "String for the 'one' category (e.g., 1 item)."
                  },
                  "two": {
                    "$ref": "common_types.json#/$defs/DynamicString",
                    "description": "String for the 'two' category (used in Arabic, Welsh, etc.)."
                  },
                  "few": {
                    "$ref": "common_types.json#/$defs/DynamicString",
                    "description": "String for the 'few' category (e.g., small groups in Slavic languages)."
                  },
                  "many": {
                    "$ref": "common_types.json#/$defs/DynamicString",
                    "description": "String for the 'many' category (e.g., large groups in various languages)."
                  },
                  "other": {
                    "$ref": "common_types.json#/$defs/DynamicString",
                    "description": "The default/fallback string (used for general plural cases)."
                  }
                },
                "required": [
                  "value",
                  "other"
                ],
                "unevaluatedProperties": false
              },
              "returnType": {
                "const": "string"
              }
            },
            "required": [
              "call",
              "args"
            ],
            "unevaluatedProperties": false
          },
          "openUrl": {
            "type": "object",
            "description": "Opens the specified URL in a browser or handler. This function has no return value.",
            "properties": {
              "call": {
                "const": "openUrl"
              },
              "args": {
                "type": "object",
                "properties": {
                  "url": {
                    "type": "string",
                    "format": "uri",
                    "description": "The URL to open."
                  }
                },
                "required": [
                  "url"
                ],
                "additionalProperties": false
              },
              "returnType": {
                "const": "void"
              }
            },
            "required": [
              "call",
              "args"
            ],
            "unevaluatedProperties": false
          },
          "and": {
            "type": "object",
            "description": "Performs a logical AND operation on a list of boolean values.",
            "properties": {
              "call": {
                "const": "and"
              },
              "args": {
                "type": "object",
                "properties": {
                  "values": {
                    "type": "array",
                    "description": "The list of boolean values to evaluate.",
                    "items": {
                      "$ref": "common_types.json#/$defs/DynamicBoolean"
                    },
                    "minItems": 2
                  }
                },
                "required": [
                  "values"
                ],
                "unevaluatedProperties": false
              },
              "returnType": {
                "const": "boolean"
              }
            },
            "required": [
              "call",
              "args"
            ],
            "unevaluatedProperties": false
          },
          "or": {
            "type": "object",
            "description": "Performs a logical OR operation on a list of boolean values.",
            "properties": {
              "call": {
                "const": "or"
              },
              "args": {
                "type": "object",
                "properties": {
                  "values": {
                    "type": "array",
                    "description": "The list of boolean values to evaluate.",
                    "items": {
                      "$ref": "common_types.json#/$defs/DynamicBoolean"
                    },
                    "minItems": 2
                  }
                },
                "required": [
                  "values"
                ],
                "unevaluatedProperties": false
              },
              "returnType": {
                "const": "boolean"
              }
            },
            "required": [
              "call",
              "args"
            ],
            "unevaluatedProperties": false
          },
          "not": {
            "type": "object",
            "description": "Performs a logical NOT operation on a boolean value.",
            "properties": {
              "call": {
                "const": "not"
              },
              "args": {
                "type": "object",
                "properties": {
                  "value": {
                    "$ref": "common_types.json#/$defs/DynamicBoolean",
                    "description": "The boolean value to negate."
                  }
                },
                "required": [
                  "value"
                ],
                "unevaluatedProperties": false
              },
              "returnType": {
                "const": "boolean"
              }
            },
            "required": [
              "call",
              "args"
            ],
            "unevaluatedProperties": false
          },
          "anyFunction": {
            "oneOf": [
              {
                "$ref": "#/$defs/required"
              },
              {
                "$ref": "#/$defs/regex"
              },
              {
                "$ref": "#/$defs/length"
              },
              {
                "$ref": "#/$defs/numeric"
              },
              {
                "$ref": "#/$defs/email"
              },
              {
                "$ref": "#/$defs/formatString"
              },
              {
                "$ref": "#/$defs/formatNumber"
              },
              {
                "$ref": "#/$defs/formatCurrency"
              },
              {
                "$ref": "#/$defs/formatDate"
              },
              {
                "$ref": "#/$defs/pluralize"
              },
              {
                "$ref": "#/$defs/openUrl"
              },
              {
                "$ref": "#/$defs/and"
              },
              {
                "$ref": "#/$defs/or"
              },
              {
                "$ref": "#/$defs/not"
              }
            ]
          }
        }
      }
    }
  };

  // node_modules/@weaver/core/dist/basic-catalog/index.js
  function cloneJson4(value) {
    if (value === null || typeof value !== "object")
      return value;
    if (Array.isArray(value))
      return value.map((entry) => cloneJson4(entry));
    const result = {};
    for (const [key3, entry] of Object.entries(value))
      result[key3] = cloneJson4(entry);
    return result;
  }
  function createBasicCatalogV091Registration() {
    return {
      catalogId: A2UI_V091_BASIC_CATALOG_ID,
      schema: cloneJson4(A2UI_V091_BASIC_CATALOG)
    };
  }

  // node_modules/@weaver/core/dist/catalog/schema.js
  var A2UI_CATALOG_SCHEMA = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    required: ["$schema", "catalogId", "components"],
    properties: {
      $schema: { const: "https://json-schema.org/draft/2020-12/schema" },
      $id: { type: "string" },
      catalogId: { type: "string" },
      components: {
        type: "object",
        minProperties: 1,
        additionalProperties: { type: "object" }
      },
      functions: { type: "object" },
      $defs: { type: "object" }
    },
    additionalProperties: true
  };

  // node_modules/@cfworker/json-schema/dist/esm/deep-compare-strict.js
  function deepCompareStrict(a, b) {
    const typeofa = typeof a;
    if (typeofa !== typeof b) {
      return false;
    }
    if (Array.isArray(a)) {
      if (!Array.isArray(b)) {
        return false;
      }
      const length2 = a.length;
      if (length2 !== b.length) {
        return false;
      }
      for (let i = 0; i < length2; i++) {
        if (!deepCompareStrict(a[i], b[i])) {
          return false;
        }
      }
      return true;
    }
    if (typeofa === "object") {
      if (!a || !b) {
        return a === b;
      }
      const aKeys = Object.keys(a);
      const bKeys = Object.keys(b);
      const length2 = aKeys.length;
      if (length2 !== bKeys.length) {
        return false;
      }
      for (const k of aKeys) {
        if (!deepCompareStrict(a[k], b[k])) {
          return false;
        }
      }
      return true;
    }
    return a === b;
  }

  // node_modules/@cfworker/json-schema/dist/esm/pointer.js
  function encodePointer(p) {
    return encodeURI(escapePointer(p));
  }
  function escapePointer(p) {
    return p.replace(/~/g, "~0").replace(/\//g, "~1");
  }

  // node_modules/@cfworker/json-schema/dist/esm/dereference.js
  var schemaArrayKeyword = {
    prefixItems: true,
    items: true,
    allOf: true,
    anyOf: true,
    oneOf: true
  };
  var schemaMapKeyword = {
    $defs: true,
    definitions: true,
    properties: true,
    patternProperties: true,
    dependentSchemas: true
  };
  var ignoredKeyword = {
    id: true,
    $id: true,
    $ref: true,
    $schema: true,
    $anchor: true,
    $vocabulary: true,
    $comment: true,
    default: true,
    enum: true,
    const: true,
    required: true,
    type: true,
    maximum: true,
    minimum: true,
    exclusiveMaximum: true,
    exclusiveMinimum: true,
    multipleOf: true,
    maxLength: true,
    minLength: true,
    pattern: true,
    format: true,
    maxItems: true,
    minItems: true,
    uniqueItems: true,
    maxProperties: true,
    minProperties: true
  };
  var initialBaseURI = typeof self !== "undefined" && self.location && self.location.origin !== "null" ? new URL(self.location.origin + self.location.pathname + location.search) : new URL("https://github.com/cfworker");
  function dereference(schema, lookup = /* @__PURE__ */ Object.create(null), baseURI = initialBaseURI, basePointer = "") {
    if (schema && typeof schema === "object" && !Array.isArray(schema)) {
      const id = schema.$id || schema.id;
      if (id) {
        const url = new URL(id, baseURI.href);
        if (url.hash.length > 1) {
          lookup[url.href] = schema;
        } else {
          url.hash = "";
          if (basePointer === "") {
            baseURI = url;
          } else {
            dereference(schema, lookup, baseURI);
          }
        }
      }
    } else if (schema !== true && schema !== false) {
      return lookup;
    }
    const schemaURI = baseURI.href + (basePointer ? "#" + basePointer : "");
    if (lookup[schemaURI] !== void 0) {
      throw new Error(`Duplicate schema URI "${schemaURI}".`);
    }
    lookup[schemaURI] = schema;
    if (schema === true || schema === false) {
      return lookup;
    }
    if (schema.__absolute_uri__ === void 0) {
      Object.defineProperty(schema, "__absolute_uri__", {
        enumerable: false,
        value: schemaURI
      });
    }
    if (schema.$ref && schema.__absolute_ref__ === void 0) {
      const url = new URL(schema.$ref, baseURI.href);
      url.hash = url.hash;
      Object.defineProperty(schema, "__absolute_ref__", {
        enumerable: false,
        value: url.href
      });
    }
    if (schema.$recursiveRef && schema.__absolute_recursive_ref__ === void 0) {
      const url = new URL(schema.$recursiveRef, baseURI.href);
      url.hash = url.hash;
      Object.defineProperty(schema, "__absolute_recursive_ref__", {
        enumerable: false,
        value: url.href
      });
    }
    if (schema.$anchor) {
      const url = new URL("#" + schema.$anchor, baseURI.href);
      lookup[url.href] = schema;
    }
    for (let key3 in schema) {
      if (ignoredKeyword[key3]) {
        continue;
      }
      const keyBase = `${basePointer}/${encodePointer(key3)}`;
      const subSchema = schema[key3];
      if (Array.isArray(subSchema)) {
        if (schemaArrayKeyword[key3]) {
          const length2 = subSchema.length;
          for (let i = 0; i < length2; i++) {
            dereference(subSchema[i], lookup, baseURI, `${keyBase}/${i}`);
          }
        }
      } else if (schemaMapKeyword[key3]) {
        for (let subKey in subSchema) {
          dereference(subSchema[subKey], lookup, baseURI, `${keyBase}/${encodePointer(subKey)}`);
        }
      } else {
        dereference(subSchema, lookup, baseURI, keyBase);
      }
    }
    return lookup;
  }

  // node_modules/@cfworker/json-schema/dist/esm/format.js
  var DATE = /^(\d\d\d\d)-(\d\d)-(\d\d)$/;
  var DAYS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  var TIME = /^(\d\d):(\d\d):(\d\d)(\.\d+)?(z|[+-]\d\d(?::?\d\d)?)?$/i;
  var HOSTNAME = /^(?=.{1,253}\.?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[-0-9a-z]{0,61}[0-9a-z])?)*\.?$/i;
  var URIREF = /^(?:[a-z][a-z0-9+\-.]*:)?(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'"()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?(?:\?(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i;
  var URITEMPLATE = /^(?:(?:[^\x00-\x20"'<>%\\^`{|}]|%[0-9a-f]{2})|\{[+#./;?&=,!@|]?(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?(?:,(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?)*\})*$/i;
  var URL_ = /^(?:(?:https?|ftp):\/\/)(?:\S+(?::\S*)?@)?(?:(?!10(?:\.\d{1,3}){3})(?!127(?:\.\d{1,3}){3})(?!169\.254(?:\.\d{1,3}){2})(?!192\.168(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z\u{00a1}-\u{ffff}0-9]+-?)*[a-z\u{00a1}-\u{ffff}0-9]+)(?:\.(?:[a-z\u{00a1}-\u{ffff}0-9]+-?)*[a-z\u{00a1}-\u{ffff}0-9]+)*(?:\.(?:[a-z\u{00a1}-\u{ffff}]{2,})))(?::\d{2,5})?(?:\/[^\s]*)?$/iu;
  var UUID = /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  var JSON_POINTER = /^(?:\/(?:[^~/]|~0|~1)*)*$/;
  var JSON_POINTER_URI_FRAGMENT = /^#(?:\/(?:[a-z0-9_\-.!$&'()*+,;:=@]|%[0-9a-f]{2}|~0|~1)*)*$/i;
  var RELATIVE_JSON_POINTER = /^(?:0|[1-9][0-9]*)(?:#|(?:\/(?:[^~/]|~0|~1)*)*)$/;
  var EMAIL = (input) => {
    if (input[0] === '"')
      return false;
    const [name, host, ...rest] = input.split("@");
    if (!name || !host || rest.length !== 0 || name.length > 64 || host.length > 253)
      return false;
    if (name[0] === "." || name.endsWith(".") || name.includes(".."))
      return false;
    if (!/^[a-z0-9.-]+$/i.test(host) || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(name))
      return false;
    return host.split(".").every((part) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i.test(part));
  };
  var IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
  var IPV6 = /^((([0-9a-f]{1,4}:){7}([0-9a-f]{1,4}|:))|(([0-9a-f]{1,4}:){6}(:[0-9a-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){5}(((:[0-9a-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){4}(((:[0-9a-f]{1,4}){1,3})|((:[0-9a-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){3}(((:[0-9a-f]{1,4}){1,4})|((:[0-9a-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){2}(((:[0-9a-f]{1,4}){1,5})|((:[0-9a-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){1}(((:[0-9a-f]{1,4}){1,6})|((:[0-9a-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9a-f]{1,4}){1,7})|((:[0-9a-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))$/i;
  var DURATION = (input) => input.length > 1 && input.length < 80 && (/^P\d+([.,]\d+)?W$/.test(input) || /^P[\dYMDTHS]*(\d[.,]\d+)?[YMDHS]$/.test(input) && /^P([.,\d]+Y)?([.,\d]+M)?([.,\d]+D)?(T([.,\d]+H)?([.,\d]+M)?([.,\d]+S)?)?$/.test(input));
  function bind(r) {
    return r.test.bind(r);
  }
  var format = {
    date,
    time: time.bind(void 0, false),
    "date-time": date_time,
    duration: DURATION,
    uri,
    "uri-reference": bind(URIREF),
    "uri-template": bind(URITEMPLATE),
    url: bind(URL_),
    email: EMAIL,
    hostname: bind(HOSTNAME),
    ipv4: bind(IPV4),
    ipv6: bind(IPV6),
    regex,
    uuid: bind(UUID),
    "json-pointer": bind(JSON_POINTER),
    "json-pointer-uri-fragment": bind(JSON_POINTER_URI_FRAGMENT),
    "relative-json-pointer": bind(RELATIVE_JSON_POINTER)
  };
  function isLeapYear(year) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  }
  function date(str) {
    const matches = str.match(DATE);
    if (!matches)
      return false;
    const year = +matches[1];
    const month = +matches[2];
    const day = +matches[3];
    return month >= 1 && month <= 12 && day >= 1 && day <= (month == 2 && isLeapYear(year) ? 29 : DAYS[month]);
  }
  function time(full, str) {
    const matches = str.match(TIME);
    if (!matches)
      return false;
    const hour = +matches[1];
    const minute = +matches[2];
    const second = +matches[3];
    const timeZone = !!matches[5];
    return (hour <= 23 && minute <= 59 && second <= 59 || hour == 23 && minute == 59 && second == 60) && (!full || timeZone);
  }
  var DATE_TIME_SEPARATOR = /t|\s/i;
  function date_time(str) {
    const dateTime = str.split(DATE_TIME_SEPARATOR);
    return dateTime.length == 2 && date(dateTime[0]) && time(true, dateTime[1]);
  }
  var NOT_URI_FRAGMENT = /\/|:/;
  var URI_PATTERN = /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)(?:\?(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i;
  function uri(str) {
    return NOT_URI_FRAGMENT.test(str) && URI_PATTERN.test(str);
  }
  var Z_ANCHOR = /[^\\]\\Z/;
  function regex(str) {
    if (Z_ANCHOR.test(str))
      return false;
    try {
      new RegExp(str, "u");
      return true;
    } catch (e) {
      return false;
    }
  }

  // node_modules/@cfworker/json-schema/dist/esm/types.js
  var OutputFormat;
  (function(OutputFormat2) {
    OutputFormat2[OutputFormat2["Flag"] = 1] = "Flag";
    OutputFormat2[OutputFormat2["Basic"] = 2] = "Basic";
    OutputFormat2[OutputFormat2["Detailed"] = 4] = "Detailed";
  })(OutputFormat || (OutputFormat = {}));

  // node_modules/@cfworker/json-schema/dist/esm/ucs2-length.js
  function ucs2length(s) {
    let result = 0;
    let length2 = s.length;
    let index = 0;
    let charCode;
    while (index < length2) {
      result++;
      charCode = s.charCodeAt(index++);
      if (charCode >= 55296 && charCode <= 56319 && index < length2) {
        charCode = s.charCodeAt(index);
        if ((charCode & 64512) == 56320) {
          index++;
        }
      }
    }
    return result;
  }

  // node_modules/@cfworker/json-schema/dist/esm/validate.js
  function validate(instance, schema, draft = "2019-09", lookup = dereference(schema), shortCircuit = true, recursiveAnchor = null, instanceLocation = "#", schemaLocation = "#", evaluated = /* @__PURE__ */ Object.create(null)) {
    if (schema === true) {
      return { valid: true, errors: [] };
    }
    if (schema === false) {
      return {
        valid: false,
        errors: [
          {
            instanceLocation,
            keyword: "false",
            keywordLocation: instanceLocation,
            error: "False boolean schema."
          }
        ]
      };
    }
    const rawInstanceType = typeof instance;
    let instanceType;
    switch (rawInstanceType) {
      case "boolean":
      case "number":
      case "string":
        instanceType = rawInstanceType;
        break;
      case "object":
        if (instance === null) {
          instanceType = "null";
        } else if (Array.isArray(instance)) {
          instanceType = "array";
        } else {
          instanceType = "object";
        }
        break;
      default:
        throw new Error(`Instances of "${rawInstanceType}" type are not supported.`);
    }
    const { $ref, $recursiveRef, $recursiveAnchor, type: $type, const: $const, enum: $enum, required: $required, not: $not, anyOf: $anyOf, allOf: $allOf, oneOf: $oneOf, if: $if, then: $then, else: $else, format: $format, properties: $properties, patternProperties: $patternProperties, additionalProperties: $additionalProperties, unevaluatedProperties: $unevaluatedProperties, minProperties: $minProperties, maxProperties: $maxProperties, propertyNames: $propertyNames, dependentRequired: $dependentRequired, dependentSchemas: $dependentSchemas, dependencies: $dependencies, prefixItems: $prefixItems, items: $items, additionalItems: $additionalItems, unevaluatedItems: $unevaluatedItems, contains: $contains, minContains: $minContains, maxContains: $maxContains, minItems: $minItems, maxItems: $maxItems, uniqueItems: $uniqueItems, minimum: $minimum, maximum: $maximum, exclusiveMinimum: $exclusiveMinimum, exclusiveMaximum: $exclusiveMaximum, multipleOf: $multipleOf, minLength: $minLength, maxLength: $maxLength, pattern: $pattern, __absolute_ref__, __absolute_recursive_ref__ } = schema;
    const errors = [];
    if ($recursiveAnchor === true && recursiveAnchor === null) {
      recursiveAnchor = schema;
    }
    if ($recursiveRef === "#") {
      const refSchema = recursiveAnchor === null ? lookup[__absolute_recursive_ref__] : recursiveAnchor;
      const keywordLocation = `${schemaLocation}/$recursiveRef`;
      const result = validate(instance, recursiveAnchor === null ? schema : recursiveAnchor, draft, lookup, shortCircuit, refSchema, instanceLocation, keywordLocation, evaluated);
      if (!result.valid) {
        errors.push({
          instanceLocation,
          keyword: "$recursiveRef",
          keywordLocation,
          error: "A subschema had errors."
        }, ...result.errors);
      }
    }
    if ($ref !== void 0) {
      const uri2 = __absolute_ref__ || $ref;
      const refSchema = lookup[uri2];
      if (refSchema === void 0) {
        let message = `Unresolved $ref "${$ref}".`;
        if (__absolute_ref__ && __absolute_ref__ !== $ref) {
          message += `  Absolute URI "${__absolute_ref__}".`;
        }
        message += `
Known schemas:
- ${Object.keys(lookup).join("\n- ")}`;
        throw new Error(message);
      }
      const keywordLocation = `${schemaLocation}/$ref`;
      const result = validate(instance, refSchema, draft, lookup, shortCircuit, recursiveAnchor, instanceLocation, keywordLocation, evaluated);
      if (!result.valid) {
        errors.push({
          instanceLocation,
          keyword: "$ref",
          keywordLocation,
          error: "A subschema had errors."
        }, ...result.errors);
      }
      if (draft === "4" || draft === "7") {
        return { valid: errors.length === 0, errors };
      }
    }
    if (Array.isArray($type)) {
      let length2 = $type.length;
      let valid = false;
      for (let i = 0; i < length2; i++) {
        if (instanceType === $type[i] || $type[i] === "integer" && instanceType === "number" && instance % 1 === 0 && instance === instance) {
          valid = true;
          break;
        }
      }
      if (!valid) {
        errors.push({
          instanceLocation,
          keyword: "type",
          keywordLocation: `${schemaLocation}/type`,
          error: `Instance type "${instanceType}" is invalid. Expected "${$type.join('", "')}".`
        });
      }
    } else if ($type === "integer") {
      if (instanceType !== "number" || instance % 1 || instance !== instance) {
        errors.push({
          instanceLocation,
          keyword: "type",
          keywordLocation: `${schemaLocation}/type`,
          error: `Instance type "${instanceType}" is invalid. Expected "${$type}".`
        });
      }
    } else if ($type !== void 0 && instanceType !== $type) {
      errors.push({
        instanceLocation,
        keyword: "type",
        keywordLocation: `${schemaLocation}/type`,
        error: `Instance type "${instanceType}" is invalid. Expected "${$type}".`
      });
    }
    if ($const !== void 0) {
      if (instanceType === "object" || instanceType === "array") {
        if (!deepCompareStrict(instance, $const)) {
          errors.push({
            instanceLocation,
            keyword: "const",
            keywordLocation: `${schemaLocation}/const`,
            error: `Instance does not match ${JSON.stringify($const)}.`
          });
        }
      } else if (instance !== $const) {
        errors.push({
          instanceLocation,
          keyword: "const",
          keywordLocation: `${schemaLocation}/const`,
          error: `Instance does not match ${JSON.stringify($const)}.`
        });
      }
    }
    if ($enum !== void 0) {
      if (instanceType === "object" || instanceType === "array") {
        if (!$enum.some((value) => deepCompareStrict(instance, value))) {
          errors.push({
            instanceLocation,
            keyword: "enum",
            keywordLocation: `${schemaLocation}/enum`,
            error: `Instance does not match any of ${JSON.stringify($enum)}.`
          });
        }
      } else if (!$enum.some((value) => instance === value)) {
        errors.push({
          instanceLocation,
          keyword: "enum",
          keywordLocation: `${schemaLocation}/enum`,
          error: `Instance does not match any of ${JSON.stringify($enum)}.`
        });
      }
    }
    if ($not !== void 0) {
      const keywordLocation = `${schemaLocation}/not`;
      const result = validate(instance, $not, draft, lookup, shortCircuit, recursiveAnchor, instanceLocation, keywordLocation);
      if (result.valid) {
        errors.push({
          instanceLocation,
          keyword: "not",
          keywordLocation,
          error: 'Instance matched "not" schema.'
        });
      }
    }
    let subEvaluateds = [];
    if ($anyOf !== void 0) {
      const keywordLocation = `${schemaLocation}/anyOf`;
      const errorsLength = errors.length;
      let anyValid = false;
      for (let i = 0; i < $anyOf.length; i++) {
        const subSchema = $anyOf[i];
        const subEvaluated = Object.create(evaluated);
        const result = validate(instance, subSchema, draft, lookup, shortCircuit, $recursiveAnchor === true ? recursiveAnchor : null, instanceLocation, `${keywordLocation}/${i}`, subEvaluated);
        errors.push(...result.errors);
        anyValid = anyValid || result.valid;
        if (result.valid) {
          subEvaluateds.push(subEvaluated);
        }
      }
      if (anyValid) {
        errors.length = errorsLength;
      } else {
        errors.splice(errorsLength, 0, {
          instanceLocation,
          keyword: "anyOf",
          keywordLocation,
          error: "Instance does not match any subschemas."
        });
      }
    }
    if ($allOf !== void 0) {
      const keywordLocation = `${schemaLocation}/allOf`;
      const errorsLength = errors.length;
      let allValid = true;
      for (let i = 0; i < $allOf.length; i++) {
        const subSchema = $allOf[i];
        const subEvaluated = Object.create(evaluated);
        const result = validate(instance, subSchema, draft, lookup, shortCircuit, $recursiveAnchor === true ? recursiveAnchor : null, instanceLocation, `${keywordLocation}/${i}`, subEvaluated);
        errors.push(...result.errors);
        allValid = allValid && result.valid;
        if (result.valid) {
          subEvaluateds.push(subEvaluated);
        }
      }
      if (allValid) {
        errors.length = errorsLength;
      } else {
        errors.splice(errorsLength, 0, {
          instanceLocation,
          keyword: "allOf",
          keywordLocation,
          error: `Instance does not match every subschema.`
        });
      }
    }
    if ($oneOf !== void 0) {
      const keywordLocation = `${schemaLocation}/oneOf`;
      const errorsLength = errors.length;
      const matches = $oneOf.filter((subSchema, i) => {
        const subEvaluated = Object.create(evaluated);
        const result = validate(instance, subSchema, draft, lookup, shortCircuit, $recursiveAnchor === true ? recursiveAnchor : null, instanceLocation, `${keywordLocation}/${i}`, subEvaluated);
        errors.push(...result.errors);
        if (result.valid) {
          subEvaluateds.push(subEvaluated);
        }
        return result.valid;
      }).length;
      if (matches === 1) {
        errors.length = errorsLength;
      } else {
        errors.splice(errorsLength, 0, {
          instanceLocation,
          keyword: "oneOf",
          keywordLocation,
          error: `Instance does not match exactly one subschema (${matches} matches).`
        });
      }
    }
    if (instanceType === "object" || instanceType === "array") {
      Object.assign(evaluated, ...subEvaluateds);
    }
    if ($if !== void 0) {
      const keywordLocation = `${schemaLocation}/if`;
      const conditionResult = validate(instance, $if, draft, lookup, shortCircuit, recursiveAnchor, instanceLocation, keywordLocation, evaluated).valid;
      if (conditionResult) {
        if ($then !== void 0) {
          const thenResult = validate(instance, $then, draft, lookup, shortCircuit, recursiveAnchor, instanceLocation, `${schemaLocation}/then`, evaluated);
          if (!thenResult.valid) {
            errors.push({
              instanceLocation,
              keyword: "if",
              keywordLocation,
              error: `Instance does not match "then" schema.`
            }, ...thenResult.errors);
          }
        }
      } else if ($else !== void 0) {
        const elseResult = validate(instance, $else, draft, lookup, shortCircuit, recursiveAnchor, instanceLocation, `${schemaLocation}/else`, evaluated);
        if (!elseResult.valid) {
          errors.push({
            instanceLocation,
            keyword: "if",
            keywordLocation,
            error: `Instance does not match "else" schema.`
          }, ...elseResult.errors);
        }
      }
    }
    if (instanceType === "object") {
      if ($required !== void 0) {
        for (const key3 of $required) {
          if (!(key3 in instance)) {
            errors.push({
              instanceLocation,
              keyword: "required",
              keywordLocation: `${schemaLocation}/required`,
              error: `Instance does not have required property "${key3}".`
            });
          }
        }
      }
      const keys = Object.keys(instance);
      if ($minProperties !== void 0 && keys.length < $minProperties) {
        errors.push({
          instanceLocation,
          keyword: "minProperties",
          keywordLocation: `${schemaLocation}/minProperties`,
          error: `Instance does not have at least ${$minProperties} properties.`
        });
      }
      if ($maxProperties !== void 0 && keys.length > $maxProperties) {
        errors.push({
          instanceLocation,
          keyword: "maxProperties",
          keywordLocation: `${schemaLocation}/maxProperties`,
          error: `Instance does not have at least ${$maxProperties} properties.`
        });
      }
      if ($propertyNames !== void 0) {
        const keywordLocation = `${schemaLocation}/propertyNames`;
        for (const key3 in instance) {
          const subInstancePointer = `${instanceLocation}/${encodePointer(key3)}`;
          const result = validate(key3, $propertyNames, draft, lookup, shortCircuit, recursiveAnchor, subInstancePointer, keywordLocation);
          if (!result.valid) {
            errors.push({
              instanceLocation,
              keyword: "propertyNames",
              keywordLocation,
              error: `Property name "${key3}" does not match schema.`
            }, ...result.errors);
          }
        }
      }
      if ($dependentRequired !== void 0) {
        const keywordLocation = `${schemaLocation}/dependantRequired`;
        for (const key3 in $dependentRequired) {
          if (key3 in instance) {
            const required2 = $dependentRequired[key3];
            for (const dependantKey of required2) {
              if (!(dependantKey in instance)) {
                errors.push({
                  instanceLocation,
                  keyword: "dependentRequired",
                  keywordLocation,
                  error: `Instance has "${key3}" but does not have "${dependantKey}".`
                });
              }
            }
          }
        }
      }
      if ($dependentSchemas !== void 0) {
        for (const key3 in $dependentSchemas) {
          const keywordLocation = `${schemaLocation}/dependentSchemas`;
          if (key3 in instance) {
            const result = validate(instance, $dependentSchemas[key3], draft, lookup, shortCircuit, recursiveAnchor, instanceLocation, `${keywordLocation}/${encodePointer(key3)}`, evaluated);
            if (!result.valid) {
              errors.push({
                instanceLocation,
                keyword: "dependentSchemas",
                keywordLocation,
                error: `Instance has "${key3}" but does not match dependant schema.`
              }, ...result.errors);
            }
          }
        }
      }
      if ($dependencies !== void 0) {
        const keywordLocation = `${schemaLocation}/dependencies`;
        for (const key3 in $dependencies) {
          if (key3 in instance) {
            const propsOrSchema = $dependencies[key3];
            if (Array.isArray(propsOrSchema)) {
              for (const dependantKey of propsOrSchema) {
                if (!(dependantKey in instance)) {
                  errors.push({
                    instanceLocation,
                    keyword: "dependencies",
                    keywordLocation,
                    error: `Instance has "${key3}" but does not have "${dependantKey}".`
                  });
                }
              }
            } else {
              const result = validate(instance, propsOrSchema, draft, lookup, shortCircuit, recursiveAnchor, instanceLocation, `${keywordLocation}/${encodePointer(key3)}`);
              if (!result.valid) {
                errors.push({
                  instanceLocation,
                  keyword: "dependencies",
                  keywordLocation,
                  error: `Instance has "${key3}" but does not match dependant schema.`
                }, ...result.errors);
              }
            }
          }
        }
      }
      const thisEvaluated = /* @__PURE__ */ Object.create(null);
      let stop = false;
      if ($properties !== void 0) {
        const keywordLocation = `${schemaLocation}/properties`;
        for (const key3 in $properties) {
          if (!(key3 in instance)) {
            continue;
          }
          const subInstancePointer = `${instanceLocation}/${encodePointer(key3)}`;
          const result = validate(instance[key3], $properties[key3], draft, lookup, shortCircuit, recursiveAnchor, subInstancePointer, `${keywordLocation}/${encodePointer(key3)}`);
          if (result.valid) {
            evaluated[key3] = thisEvaluated[key3] = true;
          } else {
            stop = shortCircuit;
            errors.push({
              instanceLocation,
              keyword: "properties",
              keywordLocation,
              error: `Property "${key3}" does not match schema.`
            }, ...result.errors);
            if (stop)
              break;
          }
        }
      }
      if (!stop && $patternProperties !== void 0) {
        const keywordLocation = `${schemaLocation}/patternProperties`;
        for (const pattern in $patternProperties) {
          const regex2 = new RegExp(pattern, "u");
          const subSchema = $patternProperties[pattern];
          for (const key3 in instance) {
            if (!regex2.test(key3)) {
              continue;
            }
            const subInstancePointer = `${instanceLocation}/${encodePointer(key3)}`;
            const result = validate(instance[key3], subSchema, draft, lookup, shortCircuit, recursiveAnchor, subInstancePointer, `${keywordLocation}/${encodePointer(pattern)}`);
            if (result.valid) {
              evaluated[key3] = thisEvaluated[key3] = true;
            } else {
              stop = shortCircuit;
              errors.push({
                instanceLocation,
                keyword: "patternProperties",
                keywordLocation,
                error: `Property "${key3}" matches pattern "${pattern}" but does not match associated schema.`
              }, ...result.errors);
            }
          }
        }
      }
      if (!stop && $additionalProperties !== void 0) {
        const keywordLocation = `${schemaLocation}/additionalProperties`;
        for (const key3 in instance) {
          if (thisEvaluated[key3]) {
            continue;
          }
          const subInstancePointer = `${instanceLocation}/${encodePointer(key3)}`;
          const result = validate(instance[key3], $additionalProperties, draft, lookup, shortCircuit, recursiveAnchor, subInstancePointer, keywordLocation);
          if (result.valid) {
            evaluated[key3] = true;
          } else {
            stop = shortCircuit;
            errors.push({
              instanceLocation,
              keyword: "additionalProperties",
              keywordLocation,
              error: `Property "${key3}" does not match additional properties schema.`
            }, ...result.errors);
          }
        }
      } else if (!stop && $unevaluatedProperties !== void 0) {
        const keywordLocation = `${schemaLocation}/unevaluatedProperties`;
        for (const key3 in instance) {
          if (!evaluated[key3]) {
            const subInstancePointer = `${instanceLocation}/${encodePointer(key3)}`;
            const result = validate(instance[key3], $unevaluatedProperties, draft, lookup, shortCircuit, recursiveAnchor, subInstancePointer, keywordLocation);
            if (result.valid) {
              evaluated[key3] = true;
            } else {
              errors.push({
                instanceLocation,
                keyword: "unevaluatedProperties",
                keywordLocation,
                error: `Property "${key3}" does not match unevaluated properties schema.`
              }, ...result.errors);
            }
          }
        }
      }
    } else if (instanceType === "array") {
      if ($maxItems !== void 0 && instance.length > $maxItems) {
        errors.push({
          instanceLocation,
          keyword: "maxItems",
          keywordLocation: `${schemaLocation}/maxItems`,
          error: `Array has too many items (${instance.length} > ${$maxItems}).`
        });
      }
      if ($minItems !== void 0 && instance.length < $minItems) {
        errors.push({
          instanceLocation,
          keyword: "minItems",
          keywordLocation: `${schemaLocation}/minItems`,
          error: `Array has too few items (${instance.length} < ${$minItems}).`
        });
      }
      const length2 = instance.length;
      let i = 0;
      let stop = false;
      if ($prefixItems !== void 0) {
        const keywordLocation = `${schemaLocation}/prefixItems`;
        const length22 = Math.min($prefixItems.length, length2);
        for (; i < length22; i++) {
          const result = validate(instance[i], $prefixItems[i], draft, lookup, shortCircuit, recursiveAnchor, `${instanceLocation}/${i}`, `${keywordLocation}/${i}`);
          evaluated[i] = true;
          if (!result.valid) {
            stop = shortCircuit;
            errors.push({
              instanceLocation,
              keyword: "prefixItems",
              keywordLocation,
              error: `Items did not match schema.`
            }, ...result.errors);
            if (stop)
              break;
          }
        }
      }
      if ($items !== void 0) {
        const keywordLocation = `${schemaLocation}/items`;
        if (Array.isArray($items)) {
          const length22 = Math.min($items.length, length2);
          for (; i < length22; i++) {
            const result = validate(instance[i], $items[i], draft, lookup, shortCircuit, recursiveAnchor, `${instanceLocation}/${i}`, `${keywordLocation}/${i}`);
            evaluated[i] = true;
            if (!result.valid) {
              stop = shortCircuit;
              errors.push({
                instanceLocation,
                keyword: "items",
                keywordLocation,
                error: `Items did not match schema.`
              }, ...result.errors);
              if (stop)
                break;
            }
          }
        } else {
          for (; i < length2; i++) {
            const result = validate(instance[i], $items, draft, lookup, shortCircuit, recursiveAnchor, `${instanceLocation}/${i}`, keywordLocation);
            evaluated[i] = true;
            if (!result.valid) {
              stop = shortCircuit;
              errors.push({
                instanceLocation,
                keyword: "items",
                keywordLocation,
                error: `Items did not match schema.`
              }, ...result.errors);
              if (stop)
                break;
            }
          }
        }
        if (!stop && $additionalItems !== void 0) {
          const keywordLocation2 = `${schemaLocation}/additionalItems`;
          for (; i < length2; i++) {
            const result = validate(instance[i], $additionalItems, draft, lookup, shortCircuit, recursiveAnchor, `${instanceLocation}/${i}`, keywordLocation2);
            evaluated[i] = true;
            if (!result.valid) {
              stop = shortCircuit;
              errors.push({
                instanceLocation,
                keyword: "additionalItems",
                keywordLocation: keywordLocation2,
                error: `Items did not match additional items schema.`
              }, ...result.errors);
            }
          }
        }
      }
      if ($contains !== void 0) {
        if (length2 === 0 && $minContains === void 0) {
          errors.push({
            instanceLocation,
            keyword: "contains",
            keywordLocation: `${schemaLocation}/contains`,
            error: `Array is empty. It must contain at least one item matching the schema.`
          });
        } else if ($minContains !== void 0 && length2 < $minContains) {
          errors.push({
            instanceLocation,
            keyword: "minContains",
            keywordLocation: `${schemaLocation}/minContains`,
            error: `Array has less items (${length2}) than minContains (${$minContains}).`
          });
        } else {
          const keywordLocation = `${schemaLocation}/contains`;
          const errorsLength = errors.length;
          let contained = 0;
          for (let j = 0; j < length2; j++) {
            const result = validate(instance[j], $contains, draft, lookup, shortCircuit, recursiveAnchor, `${instanceLocation}/${j}`, keywordLocation);
            if (result.valid) {
              evaluated[j] = true;
              contained++;
            } else {
              errors.push(...result.errors);
            }
          }
          if (contained >= ($minContains || 0)) {
            errors.length = errorsLength;
          }
          if ($minContains === void 0 && $maxContains === void 0 && contained === 0) {
            errors.splice(errorsLength, 0, {
              instanceLocation,
              keyword: "contains",
              keywordLocation,
              error: `Array does not contain item matching schema.`
            });
          } else if ($minContains !== void 0 && contained < $minContains) {
            errors.push({
              instanceLocation,
              keyword: "minContains",
              keywordLocation: `${schemaLocation}/minContains`,
              error: `Array must contain at least ${$minContains} items matching schema. Only ${contained} items were found.`
            });
          } else if ($maxContains !== void 0 && contained > $maxContains) {
            errors.push({
              instanceLocation,
              keyword: "maxContains",
              keywordLocation: `${schemaLocation}/maxContains`,
              error: `Array may contain at most ${$maxContains} items matching schema. ${contained} items were found.`
            });
          }
        }
      }
      if (!stop && $unevaluatedItems !== void 0) {
        const keywordLocation = `${schemaLocation}/unevaluatedItems`;
        for (i; i < length2; i++) {
          if (evaluated[i]) {
            continue;
          }
          const result = validate(instance[i], $unevaluatedItems, draft, lookup, shortCircuit, recursiveAnchor, `${instanceLocation}/${i}`, keywordLocation);
          evaluated[i] = true;
          if (!result.valid) {
            errors.push({
              instanceLocation,
              keyword: "unevaluatedItems",
              keywordLocation,
              error: `Items did not match unevaluated items schema.`
            }, ...result.errors);
          }
        }
      }
      if ($uniqueItems) {
        for (let j = 0; j < length2; j++) {
          const a = instance[j];
          const ao = typeof a === "object" && a !== null;
          for (let k = 0; k < length2; k++) {
            if (j === k) {
              continue;
            }
            const b = instance[k];
            const bo = typeof b === "object" && b !== null;
            if (a === b || ao && bo && deepCompareStrict(a, b)) {
              errors.push({
                instanceLocation,
                keyword: "uniqueItems",
                keywordLocation: `${schemaLocation}/uniqueItems`,
                error: `Duplicate items at indexes ${j} and ${k}.`
              });
              j = Number.MAX_SAFE_INTEGER;
              k = Number.MAX_SAFE_INTEGER;
            }
          }
        }
      }
    } else if (instanceType === "number") {
      if (draft === "4") {
        if ($minimum !== void 0 && ($exclusiveMinimum === true && instance <= $minimum || instance < $minimum)) {
          errors.push({
            instanceLocation,
            keyword: "minimum",
            keywordLocation: `${schemaLocation}/minimum`,
            error: `${instance} is less than ${$exclusiveMinimum ? "or equal to " : ""} ${$minimum}.`
          });
        }
        if ($maximum !== void 0 && ($exclusiveMaximum === true && instance >= $maximum || instance > $maximum)) {
          errors.push({
            instanceLocation,
            keyword: "maximum",
            keywordLocation: `${schemaLocation}/maximum`,
            error: `${instance} is greater than ${$exclusiveMaximum ? "or equal to " : ""} ${$maximum}.`
          });
        }
      } else {
        if ($minimum !== void 0 && instance < $minimum) {
          errors.push({
            instanceLocation,
            keyword: "minimum",
            keywordLocation: `${schemaLocation}/minimum`,
            error: `${instance} is less than ${$minimum}.`
          });
        }
        if ($maximum !== void 0 && instance > $maximum) {
          errors.push({
            instanceLocation,
            keyword: "maximum",
            keywordLocation: `${schemaLocation}/maximum`,
            error: `${instance} is greater than ${$maximum}.`
          });
        }
        if ($exclusiveMinimum !== void 0 && instance <= $exclusiveMinimum) {
          errors.push({
            instanceLocation,
            keyword: "exclusiveMinimum",
            keywordLocation: `${schemaLocation}/exclusiveMinimum`,
            error: `${instance} is less than ${$exclusiveMinimum}.`
          });
        }
        if ($exclusiveMaximum !== void 0 && instance >= $exclusiveMaximum) {
          errors.push({
            instanceLocation,
            keyword: "exclusiveMaximum",
            keywordLocation: `${schemaLocation}/exclusiveMaximum`,
            error: `${instance} is greater than or equal to ${$exclusiveMaximum}.`
          });
        }
      }
      if ($multipleOf !== void 0) {
        const remainder = instance % $multipleOf;
        if (Math.abs(0 - remainder) >= 11920929e-14 && Math.abs($multipleOf - remainder) >= 11920929e-14) {
          errors.push({
            instanceLocation,
            keyword: "multipleOf",
            keywordLocation: `${schemaLocation}/multipleOf`,
            error: `${instance} is not a multiple of ${$multipleOf}.`
          });
        }
      }
    } else if (instanceType === "string") {
      const length2 = $minLength === void 0 && $maxLength === void 0 ? 0 : ucs2length(instance);
      if ($minLength !== void 0 && length2 < $minLength) {
        errors.push({
          instanceLocation,
          keyword: "minLength",
          keywordLocation: `${schemaLocation}/minLength`,
          error: `String is too short (${length2} < ${$minLength}).`
        });
      }
      if ($maxLength !== void 0 && length2 > $maxLength) {
        errors.push({
          instanceLocation,
          keyword: "maxLength",
          keywordLocation: `${schemaLocation}/maxLength`,
          error: `String is too long (${length2} > ${$maxLength}).`
        });
      }
      if ($pattern !== void 0 && !new RegExp($pattern, "u").test(instance)) {
        errors.push({
          instanceLocation,
          keyword: "pattern",
          keywordLocation: `${schemaLocation}/pattern`,
          error: `String does not match pattern.`
        });
      }
      if ($format !== void 0 && format[$format] && !format[$format](instance)) {
        errors.push({
          instanceLocation,
          keyword: "format",
          keywordLocation: `${schemaLocation}/format`,
          error: `String does not match format "${$format}".`
        });
      }
    }
    return { valid: errors.length === 0, errors };
  }

  // node_modules/@cfworker/json-schema/dist/esm/validator.js
  var Validator = class {
    schema;
    draft;
    shortCircuit;
    lookup;
    constructor(schema, draft = "2019-09", shortCircuit = true) {
      this.schema = schema;
      this.draft = draft;
      this.shortCircuit = shortCircuit;
      this.lookup = dereference(schema);
    }
    validate(instance) {
      return validate(instance, this.schema, this.draft, this.lookup, this.shortCircuit);
    }
    addSchema(schema, id) {
      if (id) {
        schema = { ...schema, $id: id };
      }
      dereference(schema, this.lookup);
    }
  };

  // node_modules/@weaver/core/dist/catalog/schema-validator.js
  var DRAFT = "2020-12";
  var TYPES = /* @__PURE__ */ new Set(["null", "boolean", "object", "array", "number", "string", "integer"]);
  function pointer(location2) {
    if (location2 === "#" || location2 === "")
      return "/";
    return location2.startsWith("#/") ? location2.slice(1) : location2;
  }
  function requiredProperty(error2) {
    return error2.keyword === "required" ? /required property "([^"]+)"/.exec(error2.error)?.[1] : void 0;
  }
  function escapePointerSegment(value) {
    return value.replaceAll("~", "~0").replaceAll("/", "~1");
  }
  function issue(error2) {
    const base = pointer(error2.instanceLocation);
    const missing = requiredProperty(error2);
    return {
      path: missing === void 0 ? base : `${base === "/" ? "" : base}/${escapePointerSegment(missing)}`,
      message: error2.error || "Validation failed",
      keyword: error2.keyword
    };
  }
  var SchemaValidator = class {
    #validator;
    constructor(schema) {
      this.#validator = new Validator(schema, DRAFT, false);
    }
    validate(value) {
      const result = this.#validator.validate(value);
      const errors = result.errors.filter((error2) => !(["properties", "items"].includes(error2.keyword) && result.errors.some((candidate) => candidate !== error2 && candidate.instanceLocation.startsWith(`${error2.instanceLocation}/`))));
      errors.sort((left, right) => right.instanceLocation.length - left.instanceLocation.length);
      return { valid: result.valid, issues: errors.map(issue) };
    }
  };
  function object(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  function isValidSchema(schema) {
    const visit = (value) => {
      if (typeof value === "boolean")
        return true;
      if (!object(value))
        return false;
      const type = value.type;
      if (type !== void 0 && !(typeof type === "string" ? TYPES.has(type) : Array.isArray(type) && type.length > 0 && type.every((entry) => typeof entry === "string" && TYPES.has(entry))))
        return false;
      for (const key3 of ["required"]) {
        if (value[key3] !== void 0 && (!Array.isArray(value[key3]) || !value[key3].every((entry) => typeof entry === "string")))
          return false;
      }
      for (const key3 of ["oneOf", "anyOf", "allOf"]) {
        if (value[key3] !== void 0 && (!Array.isArray(value[key3]) || !value[key3].every(visit)))
          return false;
      }
      if (value.items !== void 0 && !visit(value.items))
        return false;
      if (value.not !== void 0 && !visit(value.not))
        return false;
      if (value.additionalProperties !== void 0 && typeof value.additionalProperties !== "boolean" && !visit(value.additionalProperties))
        return false;
      for (const key3 of ["properties", "$defs"]) {
        if (value[key3] !== void 0 && (!object(value[key3]) || !Object.values(value[key3]).every(visit)))
          return false;
      }
      if (value.pattern !== void 0) {
        if (typeof value.pattern !== "string")
          return false;
        try {
          new RegExp(value.pattern, "u");
        } catch {
          return false;
        }
      }
      for (const key3 of ["minimum", "maximum"]) {
        if (value[key3] !== void 0 && (typeof value[key3] !== "number" || !Number.isFinite(value[key3])))
          return false;
      }
      for (const key3 of ["minItems", "maxItems", "minProperties", "maxProperties"]) {
        if (value[key3] !== void 0 && (typeof value[key3] !== "number" || !Number.isInteger(value[key3]) || value[key3] < 0))
          return false;
      }
      return true;
    };
    return visit(schema);
  }
  function resolvesPointer(root, fragment) {
    if (fragment === "" || fragment === "#")
      return true;
    if (!fragment.startsWith("#/"))
      return false;
    let current = root;
    for (const encoded of fragment.slice(2).split("/")) {
      const segment = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
      if (!object(current) || !(segment in current))
        return false;
      current = current[segment];
    }
    return true;
  }
  function referencesResolve(schema) {
    const resources = /* @__PURE__ */ new Map();
    const collect = (value) => {
      if (!object(value)) {
        if (Array.isArray(value))
          for (const entry of value)
            collect(entry);
        return;
      }
      if (typeof value.$id === "string")
        resources.set(value.$id, value);
      for (const child of Object.values(value))
        collect(child);
    };
    collect(schema);
    const visit = (value, resource) => {
      if (Array.isArray(value))
        return value.every((entry) => visit(entry, resource));
      if (!object(value))
        return true;
      const current = typeof value.$id === "string" ? value : resource;
      if (typeof value.$ref === "string") {
        const hash = value.$ref.indexOf("#");
        const document2 = hash < 0 ? value.$ref : value.$ref.slice(0, hash);
        const fragment = hash < 0 ? "" : value.$ref.slice(hash);
        const target = document2 === "" ? current : resources.get(document2) ?? [...resources].find(([id]) => id.endsWith(document2))?.[1];
        if (target === void 0 || !resolvesPointer(target, fragment))
          return false;
      }
      return Object.values(value).every((child) => visit(child, current));
    };
    return visit(schema, schema);
  }

  // node_modules/@weaver/core/dist/catalog/CatalogRegistry.js
  var COMPONENT_ID_REF = "common_types.json#/$defs/ComponentId";
  var CHILD_LIST_REF = "common_types.json#/$defs/ChildList";
  var CHECKABLE_REF = "common_types.json#/$defs/Checkable";
  var ACTION_REF = "common_types.json#/$defs/Action";
  var DATA_BINDING_REFS = /* @__PURE__ */ new Set([
    "common_types.json#/$defs/DataBinding",
    "common_types.json#/$defs/PathBinding",
    "https://a2ui.org/specification/v0_9/common_types.json#/$defs/DataBinding",
    "https://a2ui.org/specification/v0_9_1/common_types.json#/$defs/DataBinding"
  ]);
  var FUNCTION_CALL_REFS = /* @__PURE__ */ new Set([
    "common_types.json#/$defs/FunctionCall",
    "https://a2ui.org/specification/v0_9/common_types.json#/$defs/FunctionCall",
    "https://a2ui.org/specification/v0_9_1/common_types.json#/$defs/FunctionCall"
  ]);
  var DYNAMIC_PROPERTY_REFS = {
    "common_types.json#/$defs/DynamicString": "dynamicString",
    "common_types.json#/$defs/DynamicNumber": "dynamicNumber",
    "common_types.json#/$defs/DynamicBoolean": "dynamicBoolean",
    "common_types.json#/$defs/DynamicStringList": "dynamicStringList"
  };
  var DYNAMIC_FUNCTION_ARGUMENT_REFS = {
    ...DYNAMIC_PROPERTY_REFS,
    "common_types.json#/$defs/DynamicValue": "dynamicValue",
    "https://a2ui.org/specification/v0_9/common_types.json#/$defs/DynamicString": "dynamicString",
    "https://a2ui.org/specification/v0_9/common_types.json#/$defs/DynamicNumber": "dynamicNumber",
    "https://a2ui.org/specification/v0_9/common_types.json#/$defs/DynamicBoolean": "dynamicBoolean",
    "https://a2ui.org/specification/v0_9/common_types.json#/$defs/DynamicStringList": "dynamicStringList",
    "https://a2ui.org/specification/v0_9/common_types.json#/$defs/DynamicValue": "dynamicValue",
    "https://a2ui.org/specification/v0_9_1/common_types.json#/$defs/DynamicString": "dynamicString",
    "https://a2ui.org/specification/v0_9_1/common_types.json#/$defs/DynamicNumber": "dynamicNumber",
    "https://a2ui.org/specification/v0_9_1/common_types.json#/$defs/DynamicBoolean": "dynamicBoolean",
    "https://a2ui.org/specification/v0_9_1/common_types.json#/$defs/DynamicStringList": "dynamicStringList",
    "https://a2ui.org/specification/v0_9_1/common_types.json#/$defs/DynamicValue": "dynamicValue",
    "#/$defs/DynamicString": "dynamicString",
    "#/$defs/DynamicNumber": "dynamicNumber",
    "#/$defs/DynamicBoolean": "dynamicBoolean",
    "#/$defs/DynamicStringList": "dynamicStringList",
    "#/$defs/DynamicValue": "dynamicValue"
  };
  var FUNCTION_RETURN_TYPES = [
    "string",
    "number",
    "boolean",
    "array",
    "object",
    "any",
    "void"
  ];
  function isPlainObject3(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }
  function functionArgumentDefinition(schema) {
    if (schema === void 0)
      return { kind: "dynamicValue" };
    const reference = typeof schema.$ref === "string" ? DYNAMIC_FUNCTION_ARGUMENT_REFS[schema.$ref] : void 0;
    if (reference !== void 0)
      return { kind: reference };
    if (schema.type === "array" && isPlainObject3(schema.items)) {
      const item = functionArgumentDefinition(schema.items);
      if (item.kind === "dynamicValue" || item.kind === "dynamicString" || item.kind === "dynamicNumber" || item.kind === "dynamicBoolean" || item.kind === "dynamicStringList") {
        return { kind: "arrayOfDynamicValues" };
      }
    }
    if (schema.type === "object") {
      const properties = isPlainObject3(schema.properties) ? schema.properties : void 0;
      if (properties !== void 0) {
        const fields = {};
        for (const [name, value] of Object.entries(properties)) {
          if (isPlainObject3(value))
            fields[name] = functionArgumentDefinition(value);
        }
        return { kind: "literalObject", properties: fields };
      }
      return { kind: "literalObject" };
    }
    if (schema.type === void 0 && schema.$ref === void 0 && schema.oneOf === void 0 && schema.anyOf === void 0) {
      return { kind: "dynamicValue" };
    }
    return { kind: "literal" };
  }
  function discoverFunctionDefinition(catalogId, name, functionSchema) {
    const properties = isPlainObject3(functionSchema.properties) ? functionSchema.properties : void 0;
    const returnTypeSchema = properties !== void 0 && isPlainObject3(properties.returnType) ? properties.returnType : void 0;
    const returnType = returnTypeSchema?.const;
    if (returnType !== void 0 && (typeof returnType !== "string" || !FUNCTION_RETURN_TYPES.includes(returnType))) {
      return void 0;
    }
    const argsSchema = properties !== void 0 && isPlainObject3(properties.args) ? properties.args : void 0;
    const argsProperties = argsSchema !== void 0 && isPlainObject3(argsSchema.properties) ? argsSchema.properties : void 0;
    const args = {};
    for (const [argName, schema] of Object.entries(argsProperties ?? {})) {
      if (isPlainObject3(schema))
        args[argName] = functionArgumentDefinition(schema);
    }
    return {
      catalogId,
      name,
      returnType: returnType ?? "any",
      arguments: args
    };
  }
  function cloneFunctionDefinition(definition) {
    const argumentsCopy = {};
    for (const [name, argument] of Object.entries(definition.arguments)) {
      argumentsCopy[name] = {
        kind: argument.kind,
        ...argument.properties === void 0 ? {} : { properties: cloneArgumentDefinitions(argument.properties) }
      };
    }
    return { ...definition, arguments: argumentsCopy };
  }
  function cloneArgumentDefinitions(definitions) {
    const result = {};
    for (const [name, definition] of Object.entries(definitions)) {
      result[name] = {
        kind: definition.kind,
        ...definition.properties === void 0 ? {} : { properties: cloneArgumentDefinitions(definition.properties) }
      };
    }
    return result;
  }
  function discoverStructure(componentSchema) {
    const structure = { singleChildFields: [], childListFields: [] };
    const properties = componentSchema.properties;
    if (properties === null || Array.isArray(properties) || typeof properties !== "object")
      return structure;
    for (const [property, propertySchema] of Object.entries(properties)) {
      if (propertySchema === null || Array.isArray(propertySchema) || typeof propertySchema !== "object")
        continue;
      if (propertySchema.$ref === COMPONENT_ID_REF)
        structure.singleChildFields.push(property);
      if (propertySchema.$ref === CHILD_LIST_REF)
        structure.childListFields.push(property);
    }
    return structure;
  }
  function discoverStructureLocations(componentSchema) {
    const locations = [];
    const visit = (schema, path) => {
      if (schema.$ref === COMPONENT_ID_REF) {
        locations.push({ path: path.map((segment) => ({ ...segment })), kind: "single" });
        return;
      }
      if (schema.$ref === CHILD_LIST_REF) {
        locations.push({ path: path.map((segment) => ({ ...segment })), kind: "list" });
        return;
      }
      if (isPlainObject3(schema.properties)) {
        for (const [name, child] of Object.entries(schema.properties)) {
          if (isPlainObject3(child))
            visit(child, [...path, { kind: "property", name }]);
        }
      }
      if (isPlainObject3(schema.items))
        visit(schema.items, [...path, { kind: "arrayItems" }]);
    };
    visit(componentSchema, []);
    locations.sort((left, right) => left.path.length === 1 && right.path.length === 1 ? left.kind === right.kind ? 0 : left.kind === "single" ? -1 : 1 : 0);
    return locations;
  }
  function discoverActionProperties(componentSchema) {
    const properties = componentSchema.properties;
    if (!isPlainObject3(properties))
      return [];
    return Object.entries(properties).flatMap(([property, schema]) => isPlainObject3(schema) && schema.$ref === ACTION_REF ? [property] : []);
  }
  function isCheckable(componentSchema) {
    return Array.isArray(componentSchema.allOf) && componentSchema.allOf.some((entry) => isPlainObject3(entry) && entry.$ref === CHECKABLE_REF);
  }
  function dynamicKind(schema) {
    const direct = typeof schema.$ref === "string" ? DYNAMIC_PROPERTY_REFS[schema.$ref] : void 0;
    if (direct !== void 0)
      return direct;
    if (!Array.isArray(schema.allOf))
      return void 0;
    for (const member of schema.allOf) {
      if (!isPlainObject3(member) || typeof member.$ref !== "string")
        continue;
      const wrapped = DYNAMIC_PROPERTY_REFS[member.$ref];
      if (wrapped !== void 0)
        return wrapped;
    }
    return void 0;
  }
  function discoverDynamicValueLocations(componentSchema) {
    const locations = [];
    const visit = (schema, path) => {
      const valueKind = dynamicKind(schema);
      if (valueKind !== void 0) {
        locations.push({ path: path.map((segment) => ({ ...segment })), valueKind });
        return;
      }
      if (isPlainObject3(schema.properties)) {
        for (const [name, child] of Object.entries(schema.properties)) {
          if (isPlainObject3(child))
            visit(child, [...path, { kind: "property", name }]);
        }
      }
      if (isPlainObject3(schema.items))
        visit(schema.items, [...path, { kind: "arrayItems" }]);
    };
    visit(componentSchema, []);
    return locations;
  }
  function discoverBindableValues(componentSchema) {
    const locations = [];
    const visit = (schema, path) => {
      if (Array.isArray(schema.oneOf)) {
        const branches = schema.oneOf.filter(isPlainObject3);
        const bindingBranches = branches.filter((branch) => typeof branch.$ref === "string" && DATA_BINDING_REFS.has(branch.$ref));
        const hasFunctionCall = branches.some((branch) => typeof branch.$ref === "string" && FUNCTION_CALL_REFS.has(branch.$ref));
        if (branches.length === schema.oneOf.length && bindingBranches.length === 1 && !hasFunctionCall) {
          locations.push({
            path: path.map((segment) => ({ ...segment })),
            literalSchemas: branches.filter((branch) => branch !== bindingBranches[0]).map(cloneJson5)
          });
          return;
        }
      }
      if (isPlainObject3(schema.properties)) {
        for (const [name, child] of Object.entries(schema.properties)) {
          if (isPlainObject3(child))
            visit(child, [...path, { kind: "property", name }]);
        }
      }
      if (isPlainObject3(schema.items))
        visit(schema.items, [...path, { kind: "arrayItems" }]);
    };
    visit(componentSchema, []);
    return locations.filter(({ literalSchemas }) => literalSchemas.length > 0);
  }
  function bindableLocationKey(path) {
    return JSON.stringify(path);
  }
  function discoverDynamicProperties(componentSchema) {
    const definitions = [];
    const properties = componentSchema.properties;
    if (properties === null || Array.isArray(properties) || typeof properties !== "object")
      return definitions;
    for (const [property, propertySchema] of Object.entries(properties)) {
      if (propertySchema === null || Array.isArray(propertySchema) || typeof propertySchema !== "object")
        continue;
      const valueKind = typeof propertySchema.$ref === "string" ? DYNAMIC_PROPERTY_REFS[propertySchema.$ref] : void 0;
      if (valueKind !== void 0)
        definitions.push({ property, valueKind });
    }
    return definitions;
  }
  function cloneJson5(value) {
    if (value === null || typeof value !== "object")
      return value;
    if (Array.isArray(value))
      return value.map((entry) => cloneJson5(entry));
    const result = {};
    for (const [key3, entry] of Object.entries(value))
      result[key3] = cloneJson5(entry);
    return result;
  }
  function error(code, catalogId, message) {
    return { code, catalogId, message };
  }
  function normalizeErrors(errors) {
    return errors.map(({ path, message, keyword }) => ({ path, message, keyword }));
  }
  var CatalogRegistry = class {
    #validateCatalogShape = new SchemaValidator(A2UI_CATALOG_SCHEMA);
    #catalogs = /* @__PURE__ */ new Map();
    #registrationSequence = 0;
    register(registration) {
      const { catalogId } = registration;
      if (this.#catalogs.has(catalogId)) {
        return { ok: false, error: error("CATALOG_ALREADY_REGISTERED", catalogId, "Catalog is already registered") };
      }
      let schema;
      try {
        schema = cloneJson5(registration.schema);
      } catch {
        return { ok: false, error: error("INVALID_CATALOG_SCHEMA", catalogId, "Catalog schema must be JSON data") };
      }
      const catalogShape = this.#validateCatalogShape.validate(schema);
      if (!catalogShape.valid || schema.catalogId !== catalogId) {
        const issues = normalizeErrors(catalogShape.issues);
        if (schema.catalogId !== catalogId) {
          issues.push({ path: "/catalogId", message: "Must match the registration catalogId", keyword: "const" });
        }
        return {
          ok: false,
          error: { ...error("INVALID_CATALOG_SCHEMA", catalogId, "Catalog schema is invalid"), issues }
        };
      }
      const themeSchema = schema.$defs?.theme;
      if (themeSchema === void 0) {
        return { ok: false, error: error("THEME_SCHEMA_NOT_FOUND", catalogId, "Catalog does not define $defs.theme") };
      }
      if (themeSchema === null || Array.isArray(themeSchema) || typeof themeSchema !== "object") {
        return { ok: false, error: error("INVALID_CATALOG_SCHEMA", catalogId, "Catalog theme schema is invalid") };
      }
      const components = schema.components;
      const validators2 = /* @__PURE__ */ new Map();
      const functionValidators = /* @__PURE__ */ new Map();
      const functionDefinitions = /* @__PURE__ */ new Map();
      const structures = /* @__PURE__ */ new Map();
      const structureLocations = /* @__PURE__ */ new Map();
      const dynamicProperties = /* @__PURE__ */ new Map();
      const dynamicValueLocations = /* @__PURE__ */ new Map();
      const bindableValueLocations = /* @__PURE__ */ new Map();
      const bindableValueValidators = /* @__PURE__ */ new Map();
      const actionProperties = /* @__PURE__ */ new Map();
      const checkableComponents = /* @__PURE__ */ new Set();
      const functions = schema.functions === void 0 ? {} : schema.functions;
      if (!isPlainObject3(functions)) {
        return { ok: false, error: error("INVALID_CATALOG_SCHEMA", catalogId, "Catalog functions must be an object") };
      }
      let themeValidator;
      try {
        for (const [componentName, componentSchema] of Object.entries(components)) {
          if (componentSchema === null || Array.isArray(componentSchema) || typeof componentSchema !== "object") {
            throw new Error("invalid component schema");
          }
          if (!isValidSchema(componentSchema))
            throw new Error("invalid component schema");
          structures.set(componentName, discoverStructure(componentSchema));
          structureLocations.set(componentName, discoverStructureLocations(componentSchema));
          dynamicProperties.set(componentName, discoverDynamicProperties(componentSchema));
          dynamicValueLocations.set(componentName, discoverDynamicValueLocations(componentSchema));
          const bindableValues = discoverBindableValues(componentSchema);
          bindableValueLocations.set(componentName, bindableValues.map(({ path }) => ({ path })));
          for (const [index, bindable] of bindableValues.entries()) {
            const compilationSchema2 = cloneJson5(schema);
            compilationSchema2.$id = `https://weaver.invalid/catalog/${this.#registrationSequence}/${encodeURIComponent(componentName)}/bindable-${index}/catalog.json`;
            compilationSchema2.$defs[`weaverBindable${index}`] = { oneOf: bindable.literalSchemas };
            compilationSchema2.$ref = `#/$defs/weaverBindable${index}`;
            if (!referencesResolve(compilationSchema2))
              throw new Error("unresolved schema reference");
            bindableValueValidators.set(`${componentName}:${bindableLocationKey(bindable.path)}`, new SchemaValidator(compilationSchema2));
          }
          actionProperties.set(componentName, discoverActionProperties(componentSchema));
          if (isCheckable(componentSchema))
            checkableComponents.add(componentName);
          const compilationSchema = cloneJson5(schema);
          compilationSchema.$id = `https://weaver.invalid/catalog/${this.#registrationSequence}/${encodeURIComponent(componentName)}/catalog.json`;
          compilationSchema.$defs.weaverComponent = cloneJson5(componentSchema);
          compilationSchema.$ref = "#/$defs/weaverComponent";
          if (!referencesResolve(compilationSchema))
            throw new Error("unresolved schema reference");
          validators2.set(componentName, new SchemaValidator(compilationSchema));
        }
        for (const [functionName, functionSchema] of Object.entries(functions)) {
          if (!isPlainObject3(functionSchema) || !isValidSchema(functionSchema)) {
            throw new Error("invalid function schema");
          }
          const definition = discoverFunctionDefinition(catalogId, functionName, functionSchema);
          if (definition === void 0)
            throw new Error("unsupported function return type");
          const compilationSchema = cloneJson5(schema);
          compilationSchema.$id = `https://weaver.invalid/catalog/${this.#registrationSequence}/${encodeURIComponent(functionName)}/function.json`;
          compilationSchema.$defs.weaverFunction = cloneJson5(functionSchema);
          compilationSchema.$ref = "#/$defs/weaverFunction";
          if (!referencesResolve(compilationSchema))
            throw new Error("unresolved schema reference");
          functionValidators.set(functionName, new SchemaValidator(compilationSchema));
          functionDefinitions.set(functionName, definition);
        }
        const themeCompilationSchema = cloneJson5(schema);
        themeCompilationSchema.$id = `https://weaver.invalid/catalog/${this.#registrationSequence}/theme/catalog.json`;
        themeCompilationSchema.$ref = "#/$defs/theme";
        if (!referencesResolve(themeCompilationSchema))
          throw new Error("unresolved schema reference");
        themeValidator = new SchemaValidator(themeCompilationSchema);
      } catch {
        return { ok: false, error: error("INVALID_CATALOG_SCHEMA", catalogId, "Catalog schemas could not be compiled") };
      }
      this.#registrationSequence += 1;
      this.#catalogs.set(catalogId, {
        schema,
        validators: validators2,
        functionValidators,
        functionDefinitions,
        structures,
        structureLocations,
        dynamicProperties,
        dynamicValueLocations,
        bindableValueLocations,
        bindableValueValidators,
        actionProperties,
        checkableComponents,
        themeValidator
      });
      return { ok: true, value: { catalogId, schema: cloneJson5(schema) } };
    }
    has(catalogId) {
      return this.#catalogs.has(catalogId);
    }
    get(catalogId) {
      const catalog = this.#catalogs.get(catalogId);
      return catalog === void 0 ? void 0 : { catalogId, schema: cloneJson5(catalog.schema) };
    }
    list() {
      return [...this.#catalogs].map(([catalogId, catalog]) => ({ catalogId, schema: cloneJson5(catalog.schema) }));
    }
    getSupportedCatalogIds() {
      return [...this.#catalogs.keys()];
    }
    hasFunction(catalogId, functionName) {
      return this.#catalogs.get(catalogId)?.functionValidators.has(functionName) ?? false;
    }
    /** Detects only the direct standard A2UI Checkable allOf mixin reference. */
    isComponentCheckable(catalogId, componentName) {
      return this.#catalogs.get(catalogId)?.checkableComponents.has(componentName) ?? false;
    }
    getFunctionDefinition(catalogId, functionName) {
      const catalog = this.#catalogs.get(catalogId);
      if (catalog === void 0) {
        return { ok: false, error: error("CATALOG_NOT_FOUND", catalogId, "Catalog is not registered") };
      }
      const definition = catalog.functionDefinitions.get(functionName);
      if (definition === void 0) {
        return {
          ok: false,
          error: {
            ...error("FUNCTION_NOT_ALLOWED", catalogId, "Function is not allowed by the catalog"),
            functionName
          }
        };
      }
      return { ok: true, value: cloneFunctionDefinition(definition) };
    }
    validateFunctionCall(catalogId, functionCall) {
      const catalog = this.#catalogs.get(catalogId);
      if (catalog === void 0) {
        return { ok: false, error: error("CATALOG_NOT_FOUND", catalogId, "Catalog is not registered") };
      }
      const functionName = isPlainObject3(functionCall) && typeof functionCall.call === "string" ? functionCall.call : void 0;
      if (functionName === void 0 || !catalog.functionValidators.has(functionName)) {
        return {
          ok: false,
          error: {
            ...error("FUNCTION_NOT_ALLOWED", catalogId, "Function is not allowed by the catalog"),
            ...functionName === void 0 ? {} : { functionName }
          }
        };
      }
      const issues = [];
      if (!isPlainObject3(functionCall) || !isPlainObject3(functionCall.args) || "returnType" in functionCall && (typeof functionCall.returnType !== "string" || !FUNCTION_RETURN_TYPES.includes(functionCall.returnType))) {
        issues.push({ path: "/", message: "FunctionCall must contain a call name and object args", keyword: "type" });
      }
      const validator = catalog.functionValidators.get(functionName);
      if (issues.length === 0) {
        const validation = validator.validate(functionCall);
        if (!validation.valid)
          issues.push(...normalizeErrors(validation.issues));
      }
      if (issues.length > 0) {
        return {
          ok: false,
          error: {
            ...error("FUNCTION_VALIDATION_FAILED", catalogId, "Function call does not satisfy the catalog schema"),
            functionName,
            issues
          }
        };
      }
      return { ok: true, value: functionCall };
    }
    getComponentStructure(catalogId, componentName) {
      const catalog = this.#catalogs.get(catalogId);
      if (catalog === void 0) {
        return { ok: false, error: error("CATALOG_NOT_FOUND", catalogId, "Catalog is not registered") };
      }
      const structure = catalog.structures.get(componentName);
      if (structure === void 0) {
        return {
          ok: false,
          error: {
            ...error("COMPONENT_STRUCTURE_NOT_FOUND", catalogId, "Component structural metadata is not available"),
            component: componentName
          }
        };
      }
      return {
        ok: true,
        value: {
          singleChildFields: [...structure.singleChildFields],
          childListFields: [...structure.childListFields]
        }
      };
    }
    getComponentStructureLocations(catalogId, componentName) {
      const catalog = this.#catalogs.get(catalogId);
      if (catalog === void 0) {
        return { ok: false, error: error("CATALOG_NOT_FOUND", catalogId, "Catalog is not registered") };
      }
      const locations = catalog.structureLocations.get(componentName);
      if (locations === void 0) {
        return {
          ok: false,
          error: {
            ...error("COMPONENT_STRUCTURE_NOT_FOUND", catalogId, "Component structural metadata is not available"),
            component: componentName
          }
        };
      }
      return {
        ok: true,
        value: locations.map(({ path, kind }) => ({
          path: path.map((segment) => ({ ...segment })),
          kind
        }))
      };
    }
    getDynamicProperties(catalogId, componentName) {
      const catalog = this.#catalogs.get(catalogId);
      if (catalog === void 0) {
        return { ok: false, error: error("CATALOG_NOT_FOUND", catalogId, "Catalog is not registered") };
      }
      const definitions = catalog.dynamicProperties.get(componentName);
      if (definitions === void 0) {
        return {
          ok: false,
          error: {
            ...error("COMPONENT_STRUCTURE_NOT_FOUND", catalogId, "Component property metadata is not available"),
            component: componentName
          }
        };
      }
      return { ok: true, value: definitions.map((definition) => ({ ...definition })) };
    }
    getDynamicValueLocations(catalogId, componentName) {
      const catalog = this.#catalogs.get(catalogId);
      if (catalog === void 0) {
        return { ok: false, error: error("CATALOG_NOT_FOUND", catalogId, "Catalog is not registered") };
      }
      const locations = catalog.dynamicValueLocations.get(componentName);
      if (locations === void 0) {
        return {
          ok: false,
          error: {
            ...error("COMPONENT_STRUCTURE_NOT_FOUND", catalogId, "Component property metadata is not available"),
            component: componentName
          }
        };
      }
      return {
        ok: true,
        value: locations.map(({ path, valueKind }) => ({
          path: path.map((segment) => ({ ...segment })),
          valueKind
        }))
      };
    }
    getBindableValueLocations(catalogId, componentName) {
      const catalog = this.#catalogs.get(catalogId);
      if (catalog === void 0)
        return { ok: false, error: error("CATALOG_NOT_FOUND", catalogId, "Catalog is not registered") };
      const locations = catalog.bindableValueLocations.get(componentName);
      if (locations === void 0)
        return { ok: false, error: { ...error("COMPONENT_STRUCTURE_NOT_FOUND", catalogId, "Component property metadata is not available"), component: componentName } };
      return { ok: true, value: locations.map(({ path }) => ({ path: path.map((segment) => ({ ...segment })) })) };
    }
    /** Validates a hydrated bindable value without exposing the private schema validator. */
    validateBindableValue(catalogId, componentName, location2, value) {
      const validator = this.#catalogs.get(catalogId)?.bindableValueValidators.get(`${componentName}:${bindableLocationKey(location2.path)}`);
      return validator?.validate(value).valid ?? false;
    }
    /** Detects only direct common_types.json#/$defs/Action property references. */
    getActionProperties(catalogId, componentName) {
      const catalog = this.#catalogs.get(catalogId);
      if (catalog === void 0) {
        return { ok: false, error: error("CATALOG_NOT_FOUND", catalogId, "Catalog is not registered") };
      }
      const properties = catalog.actionProperties.get(componentName);
      if (properties === void 0) {
        return {
          ok: false,
          error: {
            ...error("COMPONENT_STRUCTURE_NOT_FOUND", catalogId, "Component action metadata is not available"),
            component: componentName
          }
        };
      }
      return { ok: true, value: [...properties] };
    }
    validateTheme(catalogId, theme) {
      const catalog = this.#catalogs.get(catalogId);
      if (catalog === void 0) {
        return { ok: false, error: error("CATALOG_NOT_FOUND", catalogId, "Catalog is not registered") };
      }
      const validation = catalog.themeValidator.validate(theme);
      if (!validation.valid) {
        return {
          ok: false,
          error: {
            ...error("THEME_VALIDATION_FAILED", catalogId, "Theme does not satisfy the catalog schema"),
            issues: normalizeErrors(validation.issues)
          }
        };
      }
      return { ok: true, value: theme };
    }
    validateComponent(catalogId, component) {
      const catalog = this.#catalogs.get(catalogId);
      if (catalog === void 0) {
        return { ok: false, error: error("CATALOG_NOT_FOUND", catalogId, "Catalog is not registered") };
      }
      const validator = catalog.validators.get(component.component);
      if (validator === void 0) {
        return {
          ok: false,
          error: {
            ...error("COMPONENT_NOT_ALLOWED", catalogId, "Component type is not allowed by the catalog"),
            componentId: component.id,
            component: component.component
          }
        };
      }
      const componentId = component.id;
      const componentName = component.component;
      const validation = validator.validate(component);
      if (!validation.valid) {
        return {
          ok: false,
          error: {
            ...error("COMPONENT_VALIDATION_FAILED", catalogId, "Component does not satisfy the catalog schema"),
            componentId,
            component: componentName,
            issues: normalizeErrors(validation.issues)
          }
        };
      }
      return { ok: true, value: component };
    }
  };

  // node_modules/@weaver/core/dist/component-tree/ComponentTreeResolver.js
  function cloneJson6(value) {
    if (value === null || typeof value !== "object")
      return value;
    if (Array.isArray(value))
      return value.map(cloneJson6);
    return Object.fromEntries(Object.entries(value).map(([key3, entry]) => [key3, cloneJson6(entry)]));
  }
  function resolverError(error2) {
    return {
      code: error2.code === "CATALOG_NOT_FOUND" ? "CATALOG_NOT_FOUND" : "COMPONENT_STRUCTURE_NOT_FOUND",
      message: error2.message,
      catalogId: error2.catalogId,
      ...error2.component === void 0 ? {} : { component: error2.component },
      cause: { ...error2, ...error2.issues === void 0 ? {} : { issues: error2.issues.map((issue3) => ({ ...issue3 })) } }
    };
  }
  function dynamicChildList(value) {
    if (value === null || Array.isArray(value) || typeof value !== "object")
      return void 0;
    const object2 = value;
    return typeof object2.path === "string" && typeof object2.componentId === "string" ? { path: object2.path, componentId: object2.componentId } : void 0;
  }
  function pointer2(location2) {
    return "/" + location2.map((segment) => segment.kind === "property" ? segment.name.replaceAll("~", "~0").replaceAll("/", "~1") : String(segment.index)).join("/");
  }
  function runtimeValues(value, metadata) {
    const found = [];
    const visit = (current, offset, location2) => {
      if (offset === metadata.path.length) {
        const leaf = location2.at(-1);
        if (leaf?.kind === "property")
          found.push({ value: current, location: location2, property: leaf.name });
        return;
      }
      const segment = metadata.path[offset];
      if (segment.kind === "property") {
        if (current !== null && !Array.isArray(current) && typeof current === "object" && Object.hasOwn(current, segment.name)) {
          visit(current[segment.name], offset + 1, [...location2, { kind: "property", name: segment.name }]);
        }
        return;
      }
      if (!Array.isArray(current))
        return;
      for (let index = 0; index < current.length; index += 1) {
        visit(current[index], offset + 1, [...location2, { kind: "arrayIndex", index }]);
      }
    };
    visit(value, 0, []);
    return found;
  }
  var ComponentTreeResolver = class {
    catalogs;
    constructor(catalogs) {
      this.catalogs = catalogs;
    }
    resolve(surface) {
      return this.resolveFrom(surface, "root");
    }
    resolveFrom(surface, componentId) {
      if (!this.catalogs.has(surface.catalogId)) {
        const missing = this.catalogs.getComponentStructureLocations(surface.catalogId, componentId);
        if (!missing.ok)
          return { ok: false, error: resolverError(missing.error) };
      }
      const startingComponent = surface.components[componentId];
      if (startingComponent === void 0)
        return { ok: true, value: { ready: false, issues: [] } };
      const issues = [];
      const resolveNode = (component, ancestry) => {
        const metadata = this.catalogs.getComponentStructureLocations(surface.catalogId, component.component);
        if (!metadata.ok)
          return resolverError(metadata.error);
        const relationships = [];
        const ancestryPath = [...ancestry, component.id];
        const resolveTarget = (property, location2, targetId) => {
          const issueLocation = { location: location2.map((segment) => ({ ...segment })), propertyPath: pointer2(location2) };
          const target = surface.components[targetId];
          if (target === void 0) {
            issues.push({ code: "MISSING_COMPONENT_REFERENCE", sourceId: component.id, property, targetId, ...issueLocation });
            return void 0;
          }
          if (ancestryPath.includes(targetId)) {
            issues.push({
              code: "CIRCULAR_COMPONENT_REFERENCE",
              sourceId: component.id,
              property,
              targetId,
              path: [...ancestryPath, targetId],
              ...issueLocation
            });
            return void 0;
          }
          return resolveNode(target, ancestryPath);
        };
        for (const structural of metadata.value) {
          for (const runtime of runtimeValues(component, structural)) {
            const { property, location: location2, value } = runtime;
            if (structural.kind === "single") {
              if (typeof value !== "string")
                continue;
              const node = resolveTarget(property, location2, value);
              if (node !== void 0 && "code" in node)
                return node;
              relationships.push({ kind: "single", property, location: location2, targetId: value, ...node === void 0 ? {} : { node } });
              continue;
            }
            if (Array.isArray(value)) {
              const targetIds = value.filter((entry) => typeof entry === "string");
              const nodes = [];
              for (const targetId of targetIds) {
                const node = resolveTarget(property, location2, targetId);
                if (node !== void 0 && "code" in node)
                  return node;
                if (node !== void 0)
                  nodes.push(node);
              }
              relationships.push({ kind: "list", property, location: location2, targetIds, nodes });
              continue;
            }
            const template = dynamicChildList(value);
            if (template === void 0)
              continue;
            if (surface.components[template.componentId] === void 0) {
              issues.push({
                code: "MISSING_COMPONENT_REFERENCE",
                sourceId: component.id,
                property,
                targetId: template.componentId,
                location: location2.map((segment) => ({ ...segment })),
                propertyPath: pointer2(location2)
              });
            }
            relationships.push({ kind: "template", property, location: location2, ...template });
          }
        }
        return { id: component.id, component: component.component, definition: cloneJson6(component), relationships };
      };
      const root = resolveNode(startingComponent, []);
      if ("code" in root)
        return { ok: false, error: root };
      return { ok: true, value: { ready: true, root, issues } };
    }
  };

  // node_modules/@weaver/core/dist/component-instances/ComponentInstanceResolver.js
  function cloneJson7(value) {
    if (value === null || typeof value !== "object")
      return value;
    if (Array.isArray(value))
      return value.map(cloneJson7);
    return Object.fromEntries(Object.entries(value).map(([key3, entry]) => [key3, cloneJson7(entry)]));
  }
  function failure(cause) {
    return {
      ok: false,
      error: { code: "COMPONENT_TREE_RESOLUTION_FAILED", message: cause.message, cause }
    };
  }
  function cloneStructuralIssue(issue3) {
    return issue3.code === "CIRCULAR_COMPONENT_REFERENCE" ? { ...issue3, path: [...issue3.path] } : { ...issue3 };
  }
  function isTemplateReferenceIssue(node, issue3) {
    if (issue3.code !== "MISSING_COMPONENT_REFERENCE")
      return false;
    const visit = (current) => {
      if (current.id === issue3.sourceId && current.relationships.some((relationship) => relationship.kind === "template" && relationship.property === issue3.property && relationship.componentId === issue3.targetId))
        return true;
      return current.relationships.some((relationship) => {
        if (relationship.kind === "single")
          return relationship.node === void 0 ? false : visit(relationship.node);
        if (relationship.kind === "list")
          return relationship.nodes.some(visit);
        return false;
      });
    };
    return visit(node);
  }
  var ComponentInstanceResolver = class {
    componentTrees;
    constructor(componentTrees) {
      this.componentTrees = componentTrees;
    }
    resolve(surface) {
      const tree = this.componentTrees.resolve(surface);
      if (!tree.ok)
        return failure(tree.error);
      if (!tree.value.ready || tree.value.root === void 0) {
        return { ok: true, value: { ready: false, issues: [] } };
      }
      const issues = [];
      const issueKeys = /* @__PURE__ */ new Set();
      const addIssue = (issue3) => {
        const key3 = JSON.stringify(issue3);
        if (!issueKeys.has(key3)) {
          issueKeys.add(key3);
          issues.push(issue3);
        }
      };
      const addStructuralIssues = (root, structural) => {
        for (const issue3 of structural) {
          if (!isTemplateReferenceIssue(root, issue3))
            addIssue({ code: "STRUCTURAL_ISSUE", issue: cloneStructuralIssue(issue3) });
        }
      };
      addStructuralIssues(tree.value.root, tree.value.issues);
      const active = /* @__PURE__ */ new Set();
      const instantiate = (node, context, incomingProperty) => {
        const identity = `${node.id}\0${context.scopePath}`;
        if (active.has(identity)) {
          addIssue({
            code: "CIRCULAR_TEMPLATE_EXPANSION",
            sourceComponentId: node.id,
            scopePath: context.scopePath,
            property: incomingProperty
          });
          return void 0;
        }
        active.add(identity);
        const relationships = [];
        for (const relationship of node.relationships) {
          if (relationship.kind === "single") {
            const child = relationship.node === void 0 ? void 0 : instantiate(relationship.node, context, relationship.property);
            relationships.push({
              kind: "single",
              property: relationship.property,
              location: relationship.location.map((segment) => ({ ...segment })),
              ...child === void 0 ? {} : { child }
            });
            continue;
          }
          if (relationship.kind === "list") {
            relationships.push({
              kind: "list",
              property: relationship.property,
              location: relationship.location.map((segment) => ({ ...segment })),
              children: relationship.nodes.flatMap((childNode) => {
                const child = instantiate(childNode, context, relationship.property);
                return child === void 0 ? [] : [child];
              })
            });
            continue;
          }
          const children = [];
          relationships.push({
            kind: "template",
            property: relationship.property,
            location: relationship.location.map((segment) => ({ ...segment })),
            collectionPath: relationship.path,
            children
          });
          const collection = context.get(relationship.path);
          if (!collection.ok) {
            addIssue({
              code: "INVALID_TEMPLATE_COLLECTION_PATH",
              sourceComponentId: node.id,
              property: relationship.property,
              collectionPath: relationship.path,
              cause: { ...collection.error }
            });
            continue;
          }
          const resolvedPath = context.resolvePath(relationship.path);
          if (!resolvedPath.ok)
            continue;
          if (collection.value === void 0) {
            const cause = { code: "COLLECTION_NOT_FOUND", path: resolvedPath.value };
            addIssue({
              code: "TEMPLATE_COLLECTION_NOT_FOUND",
              sourceComponentId: node.id,
              property: relationship.property,
              collectionPath: relationship.path,
              resolvedPath: resolvedPath.value,
              cause
            });
            continue;
          }
          if (!Array.isArray(collection.value)) {
            const cause = { code: "COLLECTION_NOT_ARRAY", path: resolvedPath.value };
            addIssue({
              code: "TEMPLATE_COLLECTION_NOT_ARRAY",
              sourceComponentId: node.id,
              property: relationship.property,
              collectionPath: relationship.path,
              resolvedPath: resolvedPath.value,
              cause
            });
            continue;
          }
          if (surface.components[relationship.componentId] === void 0) {
            addIssue({
              code: "MISSING_TEMPLATE_COMPONENT",
              sourceComponentId: node.id,
              property: relationship.property,
              templateComponentId: relationship.componentId
            });
            continue;
          }
          const subtree = this.componentTrees.resolveFrom(surface, relationship.componentId);
          if (!subtree.ok) {
            active.delete(identity);
            throw subtree.error;
          }
          if (!subtree.value.ready || subtree.value.root === void 0)
            continue;
          addStructuralIssues(subtree.value.root, subtree.value.issues);
          for (let index = 0; index < collection.value.length; index += 1) {
            const childContext = context.createCollectionItemContext(relationship.path, index);
            if (!childContext.ok)
              continue;
            const child = instantiate(subtree.value.root, childContext.value, relationship.property);
            if (child !== void 0)
              children.push(child);
          }
        }
        active.delete(identity);
        return {
          sourceComponentId: node.id,
          component: node.component,
          scopePath: context.scopePath,
          ...context.collectionIndex === void 0 ? {} : { collectionIndex: context.collectionIndex },
          definition: cloneJson7(node.definition),
          relationships
        };
      };
      try {
        const root = instantiate(tree.value.root, DataContext.root(surface.dataModel), "root");
        return { ok: true, value: { ready: true, ...root === void 0 ? {} : { root }, issues } };
      } catch (error2) {
        return failure(error2);
      }
    }
  };

  // node_modules/@weaver/core/dist/component-properties/ComponentPropertyResolver.js
  function cloneJson8(value) {
    if (value === null || typeof value !== "object")
      return value;
    if (Array.isArray(value))
      return value.map(cloneJson8);
    return Object.fromEntries(Object.entries(value).map(([key3, entry]) => [key3, cloneJson8(entry)]));
  }
  function clonePlain(value) {
    if (value === null || typeof value !== "object")
      return value;
    if (Array.isArray(value))
      return value.map(clonePlain);
    return Object.fromEntries(Object.entries(value).map(([key3, entry]) => [key3, clonePlain(entry)]));
  }
  function isFunctionCall2(value) {
    return value !== null && !Array.isArray(value) && typeof value === "object" && typeof value.call === "string" && value.args !== null && !Array.isArray(value.args) && typeof value.args === "object";
  }
  function readablePath(location2) {
    return "/" + location2.map((segment) => segment.kind === "property" ? segment.name.replaceAll("~", "~0").replaceAll("/", "~1") : String(segment.index)).join("/");
  }
  function nestedLocation(location2) {
    return location2.length <= 1 ? {} : {
      location: location2.map((segment) => ({ ...segment })),
      path: readablePath(location2)
    };
  }
  function functionError(sourceComponentId, property, error2, location2) {
    return {
      code: "FUNCTION_EVALUATION_FAILED",
      sourceComponentId,
      property,
      error: error2,
      ...nestedLocation(location2)
    };
  }
  function compatible(kind, value) {
    switch (kind) {
      case "dynamicString":
        return typeof value === "string";
      case "dynamicNumber":
        return typeof value === "number" && Number.isFinite(value);
      case "dynamicBoolean":
        return typeof value === "boolean";
      case "dynamicStringList":
        return Array.isArray(value) && value.every((entry) => typeof entry === "string");
    }
  }
  function catalogFailure(cause) {
    return { code: "CATALOG_PROPERTY_METADATA_FAILED", message: cause.message, cause };
  }
  var ComponentPropertyResolver = class {
    catalogs;
    functionEvaluator;
    constructor(catalogs, functionEvaluator) {
      this.catalogs = catalogs;
      this.functionEvaluator = functionEvaluator;
    }
    resolve(instance, dataContext, catalogId) {
      const structure = this.catalogs.getComponentStructure(catalogId, instance.component);
      if (!structure.ok)
        return { ok: false, error: catalogFailure(structure.error) };
      const structuralMetadata = this.catalogs.getComponentStructureLocations(catalogId, instance.component);
      if (!structuralMetadata.ok)
        return { ok: false, error: catalogFailure(structuralMetadata.error) };
      const metadata = this.catalogs.getDynamicValueLocations(catalogId, instance.component);
      if (!metadata.ok)
        return { ok: false, error: catalogFailure(metadata.error) };
      const bindableMetadata = this.catalogs.getBindableValueLocations(catalogId, instance.component);
      if (!bindableMetadata.ok)
        return { ok: false, error: catalogFailure(bindableMetadata.error) };
      const properties = {};
      const unresolved = [];
      const issues = [];
      for (const [property, original] of Object.entries(instance.definition)) {
        if (property === "id" || property === "component")
          continue;
        properties[property] = cloneJson8(original);
      }
      const hydrateValue = (original, valueKind, location2) => {
        const property = location2[0]?.kind === "property" ? location2[0].name : "";
        let value;
        let functionOwned = false;
        if (isFunctionCall2(original)) {
          const evaluated = this.functionEvaluator.evaluate(catalogId, original, dataContext);
          if (!evaluated.ok) {
            unresolved.push({
              property,
              reason: "FUNCTION_EVALUATION_FAILED",
              functionCall: cloneJson8(original),
              ...nestedLocation(location2)
            });
            issues.push(functionError(instance.sourceComponentId, property, evaluated.error, location2));
            return void 0;
          }
          value = evaluated.value;
          functionOwned = true;
        } else if (isDataPathBinding(original)) {
          const resolved = dataContext.resolveBinding(original);
          value = resolved.ok ? resolved.value : void 0;
        } else {
          value = cloneJson8(original);
        }
        if (value !== void 0 && !compatible(valueKind, value)) {
          issues.push({
            code: "DYNAMIC_VALUE_TYPE_MISMATCH",
            sourceComponentId: instance.sourceComponentId,
            property,
            expected: valueKind,
            ...nestedLocation(location2)
          });
          return value === null ? null : void 0;
        }
        return value === void 0 ? void 0 : functionOwned ? clonePlain(value) : cloneJson8(value);
      };
      const apply = (schemaPath, offset, original, target, runtimePath, valueKind) => {
        if (offset === schemaPath.length)
          return hydrateValue(original, valueKind, runtimePath);
        const segment = schemaPath[offset];
        if (segment.kind === "property") {
          if (original === null || Array.isArray(original) || typeof original !== "object" || target === null || Array.isArray(target) || typeof target !== "object" || !Object.hasOwn(original, segment.name))
            return target;
          const originalChild = original[segment.name];
          const targetObject = target;
          targetObject[segment.name] = apply(schemaPath, offset + 1, originalChild, targetObject[segment.name], [...runtimePath, { kind: "property", name: segment.name }], valueKind);
          return target;
        }
        if (!Array.isArray(original) || !Array.isArray(target))
          return target;
        for (let index = 0; index < original.length; index += 1) {
          target[index] = apply(schemaPath, offset + 1, original[index], target[index], [...runtimePath, { kind: "arrayIndex", index }], valueKind);
        }
        return target;
      };
      for (const location2 of metadata.value) {
        const first = location2.path[0];
        if (first?.kind !== "property" || !Object.hasOwn(instance.definition, first.name))
          continue;
        properties[first.name] = apply(location2.path, 1, instance.definition[first.name], properties[first.name], [{ kind: "property", name: first.name }], location2.valueKind);
      }
      const applyBindable = (schemaPath, offset, original, target, runtimePath) => {
        if (offset === schemaPath.length) {
          if (!isDataPathBinding(original))
            return cloneJson8(original);
          const property = runtimePath[0]?.kind === "property" ? runtimePath[0].name : "";
          const resolved = dataContext.resolveBinding(original);
          if (!resolved.ok) {
            issues.push({
              code: "BINDABLE_VALUE_RESOLUTION_FAILED",
              sourceComponentId: instance.sourceComponentId,
              property,
              error: { ...resolved.error },
              location: runtimePath.map((segment2) => ({ ...segment2 })),
              path: readablePath(runtimePath)
            });
            return void 0;
          }
          if (resolved.value === void 0)
            return void 0;
          if (!this.catalogs.validateBindableValue(catalogId, instance.component, { path: schemaPath }, resolved.value)) {
            issues.push({
              code: "BINDABLE_VALUE_TYPE_MISMATCH",
              sourceComponentId: instance.sourceComponentId,
              property,
              location: runtimePath.map((segment2) => ({ ...segment2 })),
              path: readablePath(runtimePath)
            });
            return resolved.value === null ? null : void 0;
          }
          return cloneJson8(resolved.value);
        }
        const segment = schemaPath[offset];
        if (segment.kind === "property") {
          if (original === null || Array.isArray(original) || typeof original !== "object" || target === null || Array.isArray(target) || typeof target !== "object" || !Object.hasOwn(original, segment.name))
            return target;
          const targetObject = target;
          targetObject[segment.name] = applyBindable(schemaPath, offset + 1, original[segment.name], targetObject[segment.name], [...runtimePath, { kind: "property", name: segment.name }]);
          return target;
        }
        if (!Array.isArray(original) || !Array.isArray(target))
          return target;
        for (let index = 0; index < original.length; index += 1) {
          target[index] = applyBindable(schemaPath, offset + 1, original[index], target[index], [...runtimePath, { kind: "arrayIndex", index }]);
        }
        return target;
      };
      for (const location2 of bindableMetadata.value) {
        const first = location2.path[0];
        if (first?.kind !== "property" || !Object.hasOwn(instance.definition, first.name))
          continue;
        properties[first.name] = applyBindable(location2.path, 1, instance.definition[first.name], properties[first.name], [{ kind: "property", name: first.name }]);
      }
      const removeStructural = (target, path, offset) => {
        const segment = path[offset];
        if (segment === void 0)
          return;
        if (segment.kind === "property") {
          if (target === null || Array.isArray(target) || typeof target !== "object")
            return;
          if (offset === path.length - 1) {
            delete target[segment.name];
            return;
          }
          if (Object.hasOwn(target, segment.name))
            removeStructural(target[segment.name], path, offset + 1);
          return;
        }
        if (!Array.isArray(target))
          return;
        for (const item of target)
          removeStructural(item, path, offset + 1);
      };
      for (const location2 of structuralMetadata.value)
        removeStructural(properties, location2.path, 0);
      return { ok: true, value: { properties, unresolved, issues } };
    }
    resolveTree(surface, instances) {
      if (!instances.ready || instances.root === void 0) {
        return {
          ok: true,
          value: { ready: false, instanceIssues: clonePlain(instances.issues), issues: [] }
        };
      }
      const issues = [];
      const hydrate = (instance, context) => {
        const own = this.resolve(instance, context, surface.catalogId);
        if (!own.ok)
          return own;
        issues.push(...own.value.issues.map((issue3) => ({ ...issue3 })));
        const relationships = [];
        for (const relationship of instance.relationships) {
          if (relationship.kind === "single") {
            if (relationship.child === void 0) {
              relationships.push({
                kind: "single",
                property: relationship.property,
                location: relationship.location.map((segment) => ({ ...segment }))
              });
            } else {
              const child = hydrate(relationship.child, context);
              if (!child.ok)
                return child;
              relationships.push({
                kind: "single",
                property: relationship.property,
                location: relationship.location.map((segment) => ({ ...segment })),
                child: child.value
              });
            }
            continue;
          }
          if (relationship.kind === "list") {
            const children2 = [];
            for (const childInstance of relationship.children) {
              const child = hydrate(childInstance, context);
              if (!child.ok)
                return child;
              children2.push(child.value);
            }
            relationships.push({
              kind: "list",
              property: relationship.property,
              location: relationship.location.map((segment) => ({ ...segment })),
              children: children2
            });
            continue;
          }
          const children = [];
          for (const childInstance of relationship.children) {
            const index = childInstance.collectionIndex;
            const childContext = index === void 0 ? { ok: false, error: { code: "INVALID_COLLECTION_INDEX", index: Number.NaN } } : context.createCollectionItemContext(relationship.collectionPath, index);
            if (!childContext.ok) {
              return {
                ok: false,
                error: {
                  code: "DATA_CONTEXT_RECONSTRUCTION_FAILED",
                  message: "Could not reconstruct the component instance data scope",
                  cause: {
                    sourceComponentId: childInstance.sourceComponentId,
                    scopePath: childInstance.scopePath,
                    cause: { ...childContext.error }
                  }
                }
              };
            }
            const child = hydrate(childInstance, childContext.value);
            if (!child.ok)
              return child;
            children.push(child.value);
          }
          relationships.push({
            kind: "template",
            property: relationship.property,
            location: relationship.location.map((segment) => ({ ...segment })),
            collectionPath: relationship.collectionPath,
            children
          });
        }
        return {
          ok: true,
          value: {
            sourceComponentId: instance.sourceComponentId,
            component: instance.component,
            scopePath: instance.scopePath,
            ...instance.collectionIndex === void 0 ? {} : { collectionIndex: instance.collectionIndex },
            properties: own.value.properties,
            relationships,
            unresolved: own.value.unresolved
          }
        };
      };
      const root = hydrate(instances.root, DataContext.root(surface.dataModel));
      if (!root.ok)
        return root;
      return {
        ok: true,
        value: {
          ready: true,
          root: root.value,
          instanceIssues: clonePlain(instances.issues),
          issues
        }
      };
    }
  };

  // node_modules/@weaver/core/dist/input-binding/InputBindingWriter.js
  function compatible2(kind, value) {
    switch (kind) {
      case "dynamicString":
        return typeof value === "string";
      case "dynamicNumber":
        return typeof value === "number" && Number.isFinite(value);
      case "dynamicBoolean":
        return typeof value === "boolean";
      case "dynamicStringList":
        return Array.isArray(value) && value.every((entry) => typeof entry === "string");
    }
  }
  function actualType3(value) {
    if (value === null)
      return "null";
    if (Array.isArray(value))
      return "array";
    return typeof value;
  }
  function contextFor2(surface, instance) {
    const root = DataContext.root(surface.dataModel);
    if (instance.scopePath === "/")
      return { ok: true, value: root };
    const separator = instance.scopePath.lastIndexOf("/");
    const indexToken = instance.scopePath.slice(separator + 1);
    const index = instance.collectionIndex;
    if (separator < 0 || index === void 0 || indexToken !== String(index)) {
      return { ok: false, error: { code: "INVALID_COLLECTION_INDEX", index: index ?? Number.NaN } };
    }
    return root.createCollectionItemContext(instance.scopePath.slice(0, separator) || "/", index);
  }
  var InputBindingWriter = class {
    surfaceStore;
    catalogRegistry;
    constructor(surfaceStore, catalogRegistry) {
      this.surfaceStore = surfaceStore;
      this.catalogRegistry = catalogRegistry;
    }
    write({ surfaceId, instance, property, value }) {
      const surface = this.surfaceStore.get(surfaceId);
      if (surface === void 0)
        return { ok: false, error: { code: "SURFACE_NOT_FOUND", surfaceId } };
      const component = surface.components[instance.sourceComponentId];
      if (component === void 0) {
        return { ok: false, error: { code: "SOURCE_COMPONENT_NOT_FOUND", surfaceId, sourceComponentId: instance.sourceComponentId } };
      }
      if (!Object.hasOwn(component, property)) {
        return { ok: false, error: { code: "INPUT_PROPERTY_NOT_FOUND", sourceComponentId: instance.sourceComponentId, property } };
      }
      const metadata = this.catalogRegistry.getDynamicProperties(surface.catalogId, component.component);
      if (!metadata.ok)
        return { ok: false, error: { code: "CATALOG_REGISTRY_ERROR", cause: metadata.error } };
      const dynamic = metadata.value.find((definition) => definition.property === property);
      if (dynamic === void 0) {
        return { ok: false, error: { code: "INPUT_PROPERTY_NOT_DYNAMIC", sourceComponentId: instance.sourceComponentId, property } };
      }
      const binding = component[property];
      if (!isDataPathBinding(binding)) {
        return { ok: false, error: { code: "INPUT_PROPERTY_NOT_BOUND", sourceComponentId: instance.sourceComponentId, property } };
      }
      const context = contextFor2(surface, instance);
      if (!context.ok)
        return { ok: false, error: { code: "BINDING_PATH_RESOLUTION_FAILED", cause: context.error } };
      const path = context.value.resolveBindingPath(binding);
      if (!path.ok)
        return { ok: false, error: { code: "BINDING_PATH_RESOLUTION_FAILED", cause: path.error } };
      if (!compatible2(dynamic.valueKind, value)) {
        return { ok: false, error: {
          code: "INPUT_VALUE_TYPE_MISMATCH",
          sourceComponentId: instance.sourceComponentId,
          property,
          expected: dynamic.valueKind,
          actual: actualType3(value)
        } };
      }
      const mutation = this.surfaceStore.setData(surfaceId, path.value, value);
      if (!mutation.ok)
        return { ok: false, error: { code: "SURFACE_STORE_ERROR", cause: mutation.error } };
      return { ok: true, value: {
        surfaceId,
        sourceComponentId: instance.sourceComponentId,
        property,
        path: path.value,
        value: Array.isArray(value) ? [...value] : value
      } };
    }
  };

  // node_modules/@weaver/core/dist/data-model/DataModel.js
  var success4 = (value) => ({ ok: true, value });
  var DataModel = class {
    #state = {};
    #subscriptions = /* @__PURE__ */ new Set();
    get(path = "/") {
      const parsed = parsePointer(path);
      if (!parsed.ok)
        return parsed;
      const resolved = this.#readValidated(this.#state, parsed.value, path);
      if (!resolved.ok)
        return resolved;
      return success4(resolved.value === void 0 ? void 0 : cloneJson(resolved.value));
    }
    replace(value) {
      return this.set("/", value);
    }
    set(path, value) {
      const parsed = parsePointer(path);
      if (!parsed.ok)
        return parsed;
      const beforeState = this.#state;
      const nextState = cloneJson(this.#state);
      const storedValue = cloneJson(value);
      const previousValue = readTokens(beforeState, parsed.value);
      let committed;
      if (parsed.value.length === 0) {
        committed = storedValue;
      } else {
        const applied = this.#applySet(nextState, parsed.value, storedValue, path);
        if (!applied.ok)
          return applied;
        committed = nextState;
      }
      this.#state = committed;
      const change = this.#change(path, previousValue, value);
      this.#notify(parsed.value, beforeState, change);
      return success4(this.#cloneChange(change));
    }
    delete(path) {
      const parsed = parsePointer(path);
      if (!parsed.ok)
        return parsed;
      const beforeState = this.#state;
      if (parsed.value.length === 0) {
        if (equalJson(beforeState, {}))
          return success4(void 0);
        this.#state = {};
        const change2 = this.#change(path, beforeState, {});
        this.#notify(parsed.value, beforeState, change2);
        return success4(this.#cloneChange(change2));
      }
      const nextState = cloneJson(this.#state);
      const removed = this.#applyDelete(nextState, parsed.value, path);
      if (!removed.ok)
        return removed;
      if (!removed.value)
        return success4(void 0);
      this.#state = nextState;
      const previousValue = readTokens(beforeState, parsed.value);
      const change = this.#change(path, previousValue, void 0);
      this.#notify(parsed.value, beforeState, change);
      return success4(this.#cloneChange(change));
    }
    subscribe(pathOrSubscriber, possibleSubscriber) {
      const path = typeof pathOrSubscriber === "string" ? pathOrSubscriber : "/";
      const subscriber = typeof pathOrSubscriber === "function" ? pathOrSubscriber : possibleSubscriber;
      if (subscriber === void 0)
        throw new TypeError("A subscriber is required");
      const parsed = parsePointer(path);
      if (!parsed.ok)
        throw new DataModelSubscriptionError(parsed.error.code, path);
      const subscription = { tokens: parsed.value, subscriber };
      this.#subscriptions.add(subscription);
      return () => this.#subscriptions.delete(subscription);
    }
    #readValidated(root, tokens, path) {
      let current = root;
      for (const token of tokens) {
        if (current === null || typeof current !== "object")
          return success4(void 0);
        if (Array.isArray(current)) {
          if (!isArrayIndex(token)) {
            return { ok: false, error: { code: "INVALID_ARRAY_INDEX", path } };
          }
          const index = Number(token);
          if (!Number.isSafeInteger(index)) {
            return { ok: false, error: { code: "ARRAY_INDEX_TOO_LARGE", path, index } };
          }
          if (index >= current.length)
            return success4(void 0);
          current = current[index];
        } else {
          current = Object.prototype.hasOwnProperty.call(current, token) ? current[token] : void 0;
        }
      }
      return success4(current);
    }
    #applySet(root, tokens, value, path) {
      let current = root;
      for (let position = 0; position < tokens.length; position += 1) {
        const token = tokens[position];
        const final = position === tokens.length - 1;
        if (current === null || typeof current !== "object") {
          return { ok: false, error: { code: "TYPE_MISMATCH", path } };
        }
        if (Array.isArray(current)) {
          if (!isArrayIndex(token)) {
            return { ok: false, error: { code: "INVALID_ARRAY_INDEX", path } };
          }
          const index = Number(token);
          if (!Number.isSafeInteger(index) || index > current.length) {
            return { ok: false, error: { code: "ARRAY_INDEX_TOO_LARGE", path, index } };
          }
          if (final) {
            if (index === current.length)
              current.push(value);
            else
              current[index] = value;
            return success4(void 0);
          }
          if (index === current.length) {
            const container = isArrayIndex(tokens[position + 1]) ? [] : {};
            current.push(container);
            current = container;
          } else {
            current = current[index];
          }
          continue;
        }
        if (final) {
          current[token] = value;
          return success4(void 0);
        }
        if (!Object.prototype.hasOwnProperty.call(current, token)) {
          current[token] = isArrayIndex(tokens[position + 1]) ? [] : {};
        }
        current = current[token];
      }
      return success4(void 0);
    }
    #applyDelete(root, tokens, path) {
      let current = root;
      for (let position = 0; position < tokens.length - 1; position += 1) {
        const token = tokens[position];
        if (current === null || typeof current !== "object")
          return success4(false);
        if (Array.isArray(current)) {
          if (!isArrayIndex(token)) {
            return { ok: false, error: { code: "INVALID_ARRAY_INDEX", path } };
          }
          const index = Number(token);
          if (!Number.isSafeInteger(index)) {
            return { ok: false, error: { code: "ARRAY_INDEX_TOO_LARGE", path, index } };
          }
          if (index >= current.length)
            return success4(false);
          current = current[index];
        } else {
          if (!Object.prototype.hasOwnProperty.call(current, token))
            return success4(false);
          current = current[token];
        }
      }
      if (current === null || typeof current !== "object")
        return success4(false);
      const target = tokens[tokens.length - 1];
      if (Array.isArray(current)) {
        if (!isArrayIndex(target)) {
          return { ok: false, error: { code: "INVALID_ARRAY_INDEX", path } };
        }
        const index = Number(target);
        if (!Number.isSafeInteger(index)) {
          return { ok: false, error: { code: "ARRAY_INDEX_TOO_LARGE", path, index } };
        }
        if (index >= current.length)
          return success4(false);
        return { ok: false, error: { code: "ARRAY_INDEX_DELETE_UNSUPPORTED", path } };
      }
      if (!Object.prototype.hasOwnProperty.call(current, target))
        return success4(false);
      delete current[target];
      return success4(true);
    }
    #change(path, previousValue, value) {
      return {
        path,
        previousValue: previousValue === void 0 ? void 0 : cloneJson(previousValue),
        value: value === void 0 ? void 0 : cloneJson(value)
      };
    }
    #cloneChange(change) {
      return this.#change(change.path, change.previousValue, change.value);
    }
    #notify(tokens, beforeState, change) {
      for (const subscription of [...this.#subscriptions]) {
        if (!pointersRelated(tokens, subscription.tokens))
          continue;
        const before = readTokens(beforeState, subscription.tokens);
        const after = readTokens(this.#state, subscription.tokens);
        if (equalJson(before, after))
          continue;
        try {
          subscription.subscriber(after === void 0 ? void 0 : cloneJson(after), this.#cloneChange(change));
        } catch {
        }
      }
    }
  };
  var DataModelSubscriptionError = class extends Error {
    code;
    path;
    constructor(code, path) {
      super(`${code}: ${path}`);
      this.code = code;
      this.path = path;
      this.name = "DataModelSubscriptionError";
    }
  };

  // node_modules/@weaver/core/dist/protocol/a2ui/v0_9_1/outbound/client-capabilities.js
  function buildA2UIClientCapabilities(input) {
    return { "v0.9": { supportedCatalogIds: [...input.supportedCatalogIds] } };
  }

  // node_modules/@weaver/core/dist/protocol/a2ui/v0_9_1/outbound/validation-error.js
  function buildA2UIValidationFailedClientMessage(input) {
    if (input.surfaceId.length === 0)
      throw new TypeError("surfaceId must not be empty");
    return {
      version: input.version ?? "v0.9.1",
      error: {
        code: "VALIDATION_FAILED",
        surfaceId: input.surfaceId,
        path: input.path,
        message: input.message
      }
    };
  }
  function mapA2UIValidationFailure(input) {
    if (input.result.ok)
      return { ok: false, error: { code: "NOT_A_VALIDATION_FAILURE" } };
    const failure2 = input.result.error;
    let issue3;
    if (failure2.code === "PROTOCOL_VALIDATION_FAILED") {
      issue3 = failure2.issues[0];
    } else if (failure2.code === "CATALOG_REGISTRY_ERROR") {
      issue3 = mapCatalogFailure(failure2.catalogError, input.input);
    }
    if (issue3 === void 0)
      return { ok: false, error: { code: "NOT_A_VALIDATION_FAILURE" } };
    const surfaceId = extractInboundSurfaceId(input.input) ?? input.surfaceId;
    if (surfaceId === void 0 || surfaceId.length === 0) {
      return { ok: false, error: { code: "VALIDATION_ERROR_SURFACE_ID_REQUIRED" } };
    }
    return {
      ok: true,
      value: buildA2UIValidationFailedClientMessage({
        surfaceId,
        path: issue3.path,
        message: issue3.message,
        ...input.version === void 0 ? {} : { version: input.version }
      })
    };
  }
  function mapCatalogFailure(error2, input) {
    if (error2.code === "THEME_VALIDATION_FAILED") {
      const issue4 = error2.issues?.[0];
      return {
        path: prefixPath("/createSurface/theme", issue4?.path),
        message: issue4?.message ?? "Theme does not satisfy the catalog schema"
      };
    }
    if (error2.code !== "COMPONENT_VALIDATION_FAILED" && error2.code !== "COMPONENT_NOT_ALLOWED")
      return void 0;
    const componentIndex = findComponentIndex(input, error2.componentId);
    const base = `/updateComponents/components/${componentIndex ?? 0}`;
    const issue3 = error2.issues?.[0];
    return {
      path: prefixPath(base, issue3?.path),
      message: issue3?.message ?? (error2.code === "COMPONENT_NOT_ALLOWED" ? "Component type is not allowed by the catalog" : "Component does not satisfy the catalog schema")
    };
  }
  function extractInboundSurfaceId(input) {
    if (!isRecord(input))
      return void 0;
    for (const key3 of ["createSurface", "updateComponents", "updateDataModel", "deleteSurface"]) {
      const payload = input[key3];
      if (isRecord(payload) && typeof payload.surfaceId === "string" && payload.surfaceId.length > 0) {
        return payload.surfaceId;
      }
    }
    return void 0;
  }
  function findComponentIndex(input, componentId) {
    if (!isRecord(input) || !isRecord(input.updateComponents) || !Array.isArray(input.updateComponents.components))
      return void 0;
    if (componentId === void 0)
      return 0;
    const index = input.updateComponents.components.findIndex((component) => isRecord(component) && component.id === componentId);
    return index < 0 ? void 0 : index;
  }
  function prefixPath(base, path) {
    if (path === void 0 || path === "" || path === "/")
      return base;
    return `${base}${path.startsWith("/") ? path : `/${path}`}`;
  }
  function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  // node_modules/@weaver/core/dist/protocol/a2ui/v0_9_1/validation.js
  var MESSAGE_KEYS = [
    "createSurface",
    "updateComponents",
    "updateDataModel",
    "deleteSurface"
  ];
  function isRecord2(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }
  function issue2(path, message, surfaceId) {
    return surfaceId === void 0 ? { code: "VALIDATION_FAILED", path, message } : { code: "VALIDATION_FAILED", path, message, surfaceId };
  }
  function getSurfaceId(payload) {
    if (!isRecord2(payload))
      return void 0;
    return typeof payload.surfaceId === "string" ? payload.surfaceId : void 0;
  }
  function validateExactKeys(value, allowed, path, issues, surfaceId) {
    for (const key3 of Object.keys(value)) {
      if (!allowed.includes(key3)) {
        issues.push(issue2(`${path}/${key3}`, "Unexpected property", surfaceId));
      }
    }
  }
  function validateString(value, path, issues, surfaceId) {
    if (typeof value !== "string") {
      issues.push(issue2(path, "Expected string", surfaceId));
    }
  }
  function isJsonValue(value, ancestors = /* @__PURE__ */ new Set()) {
    if (value === null || typeof value === "string" || typeof value === "boolean")
      return true;
    if (typeof value === "number")
      return Number.isFinite(value);
    if (typeof value !== "object")
      return false;
    if (ancestors.has(value))
      return false;
    ancestors.add(value);
    const valid = Array.isArray(value) ? Object.keys(value).length === value.length && value.every((entry) => isJsonValue(entry, ancestors)) : isRecord2(value) && Object.values(value).every((entry) => isJsonValue(entry, ancestors));
    ancestors.delete(value);
    return valid;
  }
  function validateCreateSurface(payload, issues) {
    if (!isRecord2(payload)) {
      issues.push(issue2("/createSurface", "Expected object"));
      return;
    }
    const surfaceId = getSurfaceId(payload);
    validateExactKeys(payload, ["surfaceId", "catalogId", "theme", "sendDataModel"], "/createSurface", issues, surfaceId);
    validateString(payload.surfaceId, "/createSurface/surfaceId", issues, surfaceId);
    validateString(payload.catalogId, "/createSurface/catalogId", issues, surfaceId);
    if ("theme" in payload && (!isRecord2(payload.theme) || !isJsonValue(payload.theme))) {
      issues.push(issue2("/createSurface/theme", "Expected JSON object", surfaceId));
    }
    if ("sendDataModel" in payload && typeof payload.sendDataModel !== "boolean") {
      issues.push(issue2("/createSurface/sendDataModel", "Expected boolean", surfaceId));
    }
  }
  function validateUpdateComponents(payload, issues) {
    if (!isRecord2(payload)) {
      issues.push(issue2("/updateComponents", "Expected object"));
      return;
    }
    const surfaceId = getSurfaceId(payload);
    validateExactKeys(payload, ["surfaceId", "components"], "/updateComponents", issues, surfaceId);
    validateString(payload.surfaceId, "/updateComponents/surfaceId", issues, surfaceId);
    if (!Array.isArray(payload.components)) {
      issues.push(issue2("/updateComponents/components", "Expected array", surfaceId));
      return;
    }
    if (payload.components.length === 0) {
      issues.push(issue2("/updateComponents/components", "Expected at least one component", surfaceId));
    }
    payload.components.forEach((component, index) => {
      const path = `/updateComponents/components/${index}`;
      if (!isRecord2(component)) {
        issues.push(issue2(path, "Expected object", surfaceId));
        return;
      }
      validateString(component.id, `${path}/id`, issues, surfaceId);
      validateString(component.component, `${path}/component`, issues, surfaceId);
      for (const [key3, value] of Object.entries(component)) {
        if (!isJsonValue(value)) {
          issues.push(issue2(`${path}/${key3}`, "Expected JSON value", surfaceId));
        }
      }
    });
  }
  function validateUpdateDataModel(payload, issues) {
    if (!isRecord2(payload)) {
      issues.push(issue2("/updateDataModel", "Expected object"));
      return;
    }
    const surfaceId = getSurfaceId(payload);
    validateExactKeys(payload, ["surfaceId", "path", "value"], "/updateDataModel", issues, surfaceId);
    validateString(payload.surfaceId, "/updateDataModel/surfaceId", issues, surfaceId);
    if ("path" in payload)
      validateString(payload.path, "/updateDataModel/path", issues, surfaceId);
    if ("value" in payload && !isJsonValue(payload.value)) {
      issues.push(issue2("/updateDataModel/value", "Expected JSON value", surfaceId));
    }
  }
  function validateDeleteSurface(payload, issues) {
    if (!isRecord2(payload)) {
      issues.push(issue2("/deleteSurface", "Expected object"));
      return;
    }
    const surfaceId = getSurfaceId(payload);
    validateExactKeys(payload, ["surfaceId"], "/deleteSurface", issues, surfaceId);
    validateString(payload.surfaceId, "/deleteSurface/surfaceId", issues, surfaceId);
  }
  var validators = {
    createSurface: validateCreateSurface,
    updateComponents: validateUpdateComponents,
    updateDataModel: validateUpdateDataModel,
    deleteSurface: validateDeleteSurface
  };
  function validateA2UIServerMessage(input) {
    const issues = [];
    try {
      if (!isRecord2(input))
        return { ok: false, issues: [issue2("/", "Expected object")] };
      if (input.version !== "v0.9" && input.version !== "v0.9.1") {
        issues.push(issue2("/version", "Expected v0.9 or v0.9.1"));
      }
      const presentMessageKeys = MESSAGE_KEYS.filter((key3) => key3 in input);
      if (presentMessageKeys.length !== 1) {
        issues.push(issue2("/", "Expected exactly one A2UI message type"));
      }
      validateExactKeys(input, ["version", ...MESSAGE_KEYS], "", issues);
      if (presentMessageKeys.length === 1) {
        const key3 = presentMessageKeys[0];
        validators[key3](input[key3], issues);
      }
      return issues.length === 0 ? { ok: true, value: input } : { ok: false, issues };
    } catch {
      return { ok: false, issues: [issue2("/", "Unable to inspect input")] };
    }
  }

  // node_modules/@weaver/core/dist/surfaces/clone.js
  function cloneJson9(value) {
    if (value === null || typeof value !== "object")
      return value;
    if (Array.isArray(value)) {
      return value.map((entry) => cloneJson9(entry));
    }
    const clone = {};
    for (const [key3, entry] of Object.entries(value)) {
      clone[key3] = cloneJson9(entry);
    }
    return clone;
  }

  // node_modules/@weaver/core/dist/surfaces/SurfaceStore.js
  var success5 = (value) => ({ ok: true, value });
  var SurfaceStore = class {
    #surfaces = /* @__PURE__ */ new Map();
    #subscribers = /* @__PURE__ */ new Map();
    create(input) {
      if (this.#surfaces.has(input.surfaceId)) {
        return {
          ok: false,
          error: { code: "SURFACE_ALREADY_EXISTS", surfaceId: input.surfaceId }
        };
      }
      const surface = {
        surfaceId: input.surfaceId,
        catalogId: input.catalogId,
        ...input.theme === void 0 ? {} : { theme: cloneJson9(input.theme) },
        sendDataModel: input.sendDataModel ?? false,
        components: /* @__PURE__ */ new Map(),
        dataModel: new DataModel()
      };
      this.#surfaces.set(input.surfaceId, surface);
      const snapshot = this.#snapshot(surface);
      this.#notify(input.surfaceId, () => ({ type: "created", surface: this.#snapshot(surface) }));
      return success5(snapshot);
    }
    has(surfaceId) {
      return this.#surfaces.has(surfaceId);
    }
    get(surfaceId) {
      const surface = this.#surfaces.get(surfaceId);
      return surface === void 0 ? void 0 : this.#snapshot(surface);
    }
    list() {
      return Array.from(this.#surfaces.values(), (surface) => this.#snapshot(surface));
    }
    hasRoot(surfaceId) {
      return this.#surfaces.get(surfaceId)?.components.has("root") ?? false;
    }
    getData(surfaceId, path = "/") {
      const surface = this.#surfaces.get(surfaceId);
      if (surface === void 0) {
        return { ok: false, error: { code: "SURFACE_NOT_FOUND", surfaceId } };
      }
      return this.#mapDataModelResult(surface.dataModel.get(path));
    }
    replaceData(surfaceId, value) {
      return this.#mutateData(surfaceId, "/", (dataModel) => dataModel.replace(value));
    }
    setData(surfaceId, path, value) {
      return this.#mutateData(surfaceId, path, (dataModel) => dataModel.set(path, value));
    }
    deleteData(surfaceId, path) {
      return this.#mutateData(surfaceId, path, (dataModel) => dataModel.delete(path));
    }
    updateComponents(surfaceId, components) {
      const surface = this.#surfaces.get(surfaceId);
      if (surface === void 0) {
        return { ok: false, error: { code: "SURFACE_NOT_FOUND", surfaceId } };
      }
      const ids = /* @__PURE__ */ new Set();
      for (const component of components) {
        if (ids.has(component.id)) {
          return {
            ok: false,
            error: {
              code: "DUPLICATE_COMPONENT_ID",
              surfaceId,
              componentId: component.id
            }
          };
        }
        ids.add(component.id);
      }
      for (const component of components) {
        surface.components.set(component.id, cloneJson9(component));
      }
      const componentIds = [...ids];
      const snapshot = this.#snapshot(surface);
      this.#notify(surfaceId, () => ({
        type: "componentsUpdated",
        surface: this.#snapshot(surface),
        componentIds: [...componentIds]
      }));
      return success5(snapshot);
    }
    delete(surfaceId) {
      if (!this.#surfaces.delete(surfaceId)) {
        return { ok: false, error: { code: "SURFACE_NOT_FOUND", surfaceId } };
      }
      this.#notify(surfaceId, () => ({ type: "deleted", surfaceId }));
      this.#subscribers.delete(surfaceId);
      return success5(void 0);
    }
    subscribe(surfaceId, subscriber) {
      let subscribers = this.#subscribers.get(surfaceId);
      if (subscribers === void 0) {
        subscribers = /* @__PURE__ */ new Set();
        this.#subscribers.set(surfaceId, subscribers);
      }
      subscribers.add(subscriber);
      return () => {
        subscribers.delete(subscriber);
        if (subscribers.size === 0)
          this.#subscribers.delete(surfaceId);
      };
    }
    #snapshot(surface) {
      const components = {};
      for (const [id, component] of surface.components) {
        components[id] = cloneJson9(component);
      }
      return {
        surfaceId: surface.surfaceId,
        catalogId: surface.catalogId,
        ...surface.theme === void 0 ? {} : { theme: cloneJson9(surface.theme) },
        sendDataModel: surface.sendDataModel,
        components,
        dataModel: this.#dataSnapshot(surface.dataModel)
      };
    }
    #dataSnapshot(dataModel) {
      const result = dataModel.get();
      if (!result.ok || result.value === void 0) {
        throw new Error("DataModel root invariant violated");
      }
      return result.value;
    }
    #mapDataModelResult(result) {
      return result.ok ? success5(result.value) : { ok: false, error: { code: "DATA_MODEL_ERROR", dataModelError: result.error } };
    }
    #mutateData(surfaceId, path, mutate) {
      const surface = this.#surfaces.get(surfaceId);
      if (surface === void 0) {
        return { ok: false, error: { code: "SURFACE_NOT_FOUND", surfaceId } };
      }
      const mutation = this.#mapDataModelResult(mutate(surface.dataModel));
      if (!mutation.ok)
        return mutation;
      const snapshot = this.#snapshot(surface);
      const change = mutation.value;
      const changed = change !== void 0 && JSON.stringify(change.previousValue) !== JSON.stringify(change.value);
      if (changed) {
        this.#notify(surfaceId, () => ({
          type: "dataModelUpdated",
          surface: this.#snapshot(surface),
          path
        }));
      }
      return success5(snapshot);
    }
    #notify(surfaceId, createChange) {
      const subscribers = this.#subscribers.get(surfaceId);
      if (subscribers === void 0)
        return;
      for (const subscriber of [...subscribers]) {
        try {
          subscriber(createChange());
        } catch {
        }
      }
    }
  };

  // node_modules/@weaver/core/dist/message-processor/A2UIMessageProcessor.js
  var A2UIMessageProcessor = class {
    store;
    catalogs;
    constructor(store, catalogs) {
      this.store = store;
      this.catalogs = catalogs;
    }
    process(input) {
      const validation = validateA2UIServerMessage(input);
      if (!validation.ok) {
        return {
          ok: false,
          error: { code: "PROTOCOL_VALIDATION_FAILED", issues: validation.issues }
        };
      }
      return this.dispatch(validation.value);
    }
    dispatch(message) {
      if ("createSurface" in message) {
        const create = message.createSurface;
        if (!this.catalogs.has(create.catalogId)) {
          return this.catalogError({
            code: "CATALOG_NOT_FOUND",
            catalogId: create.catalogId,
            message: "Catalog is not registered"
          });
        }
        if (this.store.has(create.surfaceId)) {
          return this.storeError({ code: "SURFACE_ALREADY_EXISTS", surfaceId: create.surfaceId });
        }
        if (create.theme !== void 0) {
          const validation = this.catalogs.validateTheme(create.catalogId, create.theme);
          if (!validation.ok)
            return this.catalogError(validation.error);
        }
        return this.withSurface("surfaceCreated", create.surfaceId, this.store.create({
          surfaceId: create.surfaceId,
          catalogId: create.catalogId,
          ...create.theme === void 0 ? {} : { theme: create.theme },
          ...create.sendDataModel === void 0 ? {} : { sendDataModel: create.sendDataModel }
        }));
      }
      if ("updateComponents" in message) {
        const update = message.updateComponents;
        const surface = this.store.get(update.surfaceId);
        if (surface === void 0) {
          return this.storeError({ code: "SURFACE_NOT_FOUND", surfaceId: update.surfaceId });
        }
        for (const component of update.components) {
          const validation = this.catalogs.validateComponent(surface.catalogId, component);
          if (!validation.ok)
            return this.catalogError(validation.error);
        }
        return this.withSurface("componentsUpdated", update.surfaceId, this.store.updateComponents(update.surfaceId, update.components));
      }
      if ("updateDataModel" in message) {
        const update = message.updateDataModel;
        const path = update.path ?? "/";
        const hasValue = Object.prototype.hasOwnProperty.call(update, "value");
        const result = hasValue ? path === "/" ? this.store.replaceData(update.surfaceId, update.value) : this.store.setData(update.surfaceId, path, update.value) : this.store.deleteData(update.surfaceId, path);
        return this.withSurface("dataModelUpdated", update.surfaceId, result);
      }
      const deletion = this.store.delete(message.deleteSurface.surfaceId);
      if (!deletion.ok)
        return this.storeError(deletion.error);
      return {
        ok: true,
        value: { operation: "surfaceDeleted", surfaceId: message.deleteSurface.surfaceId }
      };
    }
    withSurface(operation, surfaceId, result) {
      if (!result.ok)
        return this.storeError(result.error);
      const value = { operation, surfaceId, surface: result.value };
      return { ok: true, value };
    }
    storeError(error2) {
      return { ok: false, error: { code: "SURFACE_STORE_ERROR", storeError: error2 } };
    }
    catalogError(error2) {
      return { ok: false, error: { code: "CATALOG_REGISTRY_ERROR", catalogError: error2 } };
    }
  };

  // node_modules/@weaver/core/dist/runtime/WeaverRuntime.js
  var WeaverRuntime = class {
    #services;
    /** @internal Construct runtimes through createWeaverRuntime(). */
    constructor(services) {
      this.#services = services;
    }
    process(input) {
      return this.#services.processor.process(input);
    }
    processMany(inputs) {
      return inputs.map((input) => this.process(input));
    }
    getSurface(surfaceId) {
      return this.#services.store.get(surfaceId);
    }
    resolveSurface(surfaceId) {
      const surface = this.#services.store.get(surfaceId);
      if (surface === void 0)
        return { ok: false, error: { code: "SURFACE_NOT_FOUND", surfaceId } };
      const tree = this.#services.trees.resolve(surface);
      if (!tree.ok)
        return { ok: false, error: { code: "COMPONENT_TREE_RESOLUTION_FAILED", cause: tree.error } };
      const instances = this.#services.instances.resolve(surface);
      if (!instances.ok)
        return { ok: false, error: { code: "COMPONENT_INSTANCE_RESOLUTION_FAILED", cause: instances.error } };
      const hydrated = this.#services.properties.resolveTree(surface, instances.value);
      if (!hydrated.ok)
        return { ok: false, error: { code: "COMPONENT_PROPERTY_RESOLUTION_FAILED", cause: hydrated.error } };
      const checks = this.#services.checks.evaluateTree(surface, instances.value);
      if (!checks.ok)
        return { ok: false, error: { code: "CHECK_EVALUATION_FAILED", cause: checks.error } };
      return {
        ok: true,
        value: {
          surfaceId: surface.surfaceId,
          catalogId: surface.catalogId,
          ...surface.theme === void 0 ? {} : { theme: structuredClone(surface.theme) },
          sendDataModel: surface.sendDataModel,
          tree: hydrated.value,
          checks: checks.value,
          issues: {
            tree: structuredClone(tree.value.issues),
            instances: structuredClone(instances.value.issues),
            properties: structuredClone(hydrated.value.issues)
          }
        }
      };
    }
    writeInput(request) {
      const current = this.#resolveCurrentInstance(request);
      if (!current.ok)
        return current;
      const written = this.#services.inputs.write({
        surfaceId: request.surfaceId,
        instance: current.value.instance,
        property: request.property,
        value: request.value
      });
      return written.ok ? written : { ok: false, error: { code: "INPUT_WRITE_FAILED", cause: written.error } };
    }
    dispatchAction(request) {
      const current = this.#resolveCurrentInstance(request);
      if (!current.ok)
        return current;
      const dispatched = this.#services.actions.dispatch({
        surface: current.value.surface,
        instance: current.value.instance,
        actionProperty: request.actionProperty
      });
      return dispatched.ok ? dispatched : { ok: false, error: { code: "ACTION_DISPATCH_FAILED", cause: dispatched.error } };
    }
    subscribeSurface(surfaceId, subscriber) {
      return this.#services.store.subscribe(surfaceId, () => subscriber(this.resolveSurface(surfaceId)));
    }
    getClientCapabilities() {
      return buildA2UIClientCapabilities({
        supportedCatalogIds: this.#services.catalogs.getSupportedCatalogIds()
      });
    }
    mapProcessFailureToValidationMessage(input) {
      return mapA2UIValidationFailure(input);
    }
    #resolveCurrentInstance(identity) {
      const surface = this.#services.store.get(identity.surfaceId);
      if (surface === void 0)
        return { ok: false, error: { code: "SURFACE_NOT_FOUND", surfaceId: identity.surfaceId } };
      const instances = this.#services.instances.resolve(surface);
      if (!instances.ok)
        return { ok: false, error: { code: "INSTANCE_RESOLUTION_FAILED", cause: instances.error } };
      const instance = instances.value.root === void 0 ? void 0 : findInstance(instances.value.root, identity.sourceComponentId, identity.scopePath);
      if (instance === void 0) {
        return { ok: false, error: {
          code: "INSTANCE_NOT_FOUND",
          surfaceId: identity.surfaceId,
          sourceComponentId: identity.sourceComponentId,
          scopePath: identity.scopePath
        } };
      }
      return { ok: true, value: { surface, instance } };
    }
  };
  function findInstance(root, sourceComponentId, scopePath) {
    if (root.sourceComponentId === sourceComponentId && root.scopePath === scopePath)
      return root;
    for (const relationship of root.relationships) {
      const children = relationship.kind === "single" ? relationship.child === void 0 ? [] : [relationship.child] : relationship.children;
      for (const child of children) {
        const found = findInstance(child, sourceComponentId, scopePath);
        if (found !== void 0)
          return found;
      }
    }
    return void 0;
  }
  function createWeaverRuntime(config = { catalogs: [] }) {
    const catalogs = new CatalogRegistry();
    for (const registration of config.catalogs) {
      const result = catalogs.register(registration);
      if (!result.ok)
        return { ok: false, error: { code: "CATALOG_CONFIGURATION_FAILED", catalogError: result.error } };
    }
    const functions = new FunctionRegistry(catalogs);
    for (const registration of config.functions ?? []) {
      const result = functions.register(registration);
      if (!result.ok)
        return { ok: false, error: { code: "FUNCTION_CONFIGURATION_FAILED", functionError: result.error } };
    }
    const store = new SurfaceStore();
    const functionEvaluator = new FunctionEvaluator(catalogs, functions);
    const trees = new ComponentTreeResolver(catalogs);
    const instances = new ComponentInstanceResolver(trees);
    const checks = new CheckEvaluator(catalogs, functionEvaluator);
    return { ok: true, value: new WeaverRuntime({
      catalogs,
      functions,
      store,
      processor: new A2UIMessageProcessor(store, catalogs),
      trees,
      instances,
      properties: new ComponentPropertyResolver(catalogs, functionEvaluator),
      checks,
      inputs: new InputBindingWriter(store, catalogs),
      actions: new ActionDispatcher(catalogs, functionEvaluator, checks, { ...config.now === void 0 ? {} : { now: config.now } })
    }) };
  }

  // node_modules/@weaver/web/dist/renderers/errors.js
  var RendererRegistryConfigurationError = class extends Error {
    code = "RENDERER_ALREADY_REGISTERED";
    catalogId;
    component;
    constructor(catalogId, component) {
      super(`A renderer is already registered for ${catalogId} / ${component}`);
      this.name = "RendererRegistryConfigurationError";
      this.catalogId = catalogId;
      this.component = component;
    }
  };

  // node_modules/@weaver/web/dist/renderers/RendererRegistry.js
  var key2 = (catalogId, component) => JSON.stringify([catalogId, component]);
  var RendererRegistry = class {
    #renderers = /* @__PURE__ */ new Map();
    #metadata;
    constructor(registrations) {
      const metadata = [];
      for (const registration of registrations) {
        const identity = key2(registration.catalogId, registration.component);
        if (this.#renderers.has(identity)) {
          throw new RendererRegistryConfigurationError(registration.catalogId, registration.component);
        }
        this.#renderers.set(identity, registration.render);
        metadata.push({ catalogId: registration.catalogId, component: registration.component });
      }
      this.#metadata = metadata;
    }
    get(catalogId, component) {
      return this.#renderers.get(key2(catalogId, component));
    }
    has(catalogId, component) {
      return this.#renderers.has(key2(catalogId, component));
    }
    list() {
      return this.#metadata.map((entry) => ({ ...entry }));
    }
  };

  // node_modules/@weaver/web/dist/surface/WebSurfaceRenderer.js
  var identityKey = (sourceComponentId, scopePath) => JSON.stringify([sourceComponentId, scopePath]);
  var controlIdentityKey = (sourceComponentId, scopePath, localKey) => JSON.stringify([sourceComponentId, scopePath, localKey]);
  var WebSurfaceRenderer = class {
    #runtime;
    #renderers;
    #themeAdapter;
    #attributionProvider;
    #onServerEvent;
    constructor(config) {
      this.#runtime = config.runtime;
      this.#renderers = config.renderers;
      this.#themeAdapter = config.themeAdapter;
      this.#attributionProvider = config.attributionProvider;
      this.#onServerEvent = config.onServerEvent;
    }
    mount(options) {
      const document2 = options.target.ownerDocument;
      const container = document2.createElement("div");
      container.setAttribute("data-weaver-mount", "");
      let mounted = true;
      let generation = 0;
      let controlMetadata = /* @__PURE__ */ new WeakMap();
      let controls = /* @__PURE__ */ new Map();
      const localState = /* @__PURE__ */ new Map();
      const appliedThemeProperties = /* @__PURE__ */ new Set();
      const render = () => {
        const focus = captureFocus(container, document2, controlMetadata);
        const renderGeneration = ++generation;
        const nextControlMetadata = /* @__PURE__ */ new WeakMap();
        const nextControls = /* @__PURE__ */ new Map();
        const renderedIdentities = /* @__PURE__ */ new Set();
        const result = this.#render(options.surfaceId, container, document2, renderGeneration, () => mounted && generation === renderGeneration, () => render(), localState, renderedIdentities, nextControlMetadata, nextControls, appliedThemeProperties);
        if (result.ok) {
          controlMetadata = nextControlMetadata;
          controls = nextControls;
          if (!result.value.ready)
            localState.clear();
          else
            for (const identity of localState.keys())
              if (!renderedIdentities.has(identity))
                localState.delete(identity);
          if (mounted)
            restoreFocus(focus, controls);
        }
        return result;
      };
      let lastResult = render();
      if (!lastResult.ok) {
        mounted = false;
        generation++;
        localState.clear();
        return lastResult;
      }
      options.target.append(container);
      const unsubscribe = this.#runtime.subscribeSurface(options.surfaceId, () => {
        if (!mounted)
          return;
        lastResult = render();
        if (!lastResult.ok && options.onError !== void 0) {
          try {
            options.onError(lastResult.error);
          } catch {
          }
        }
      });
      return {
        ok: true,
        value: {
          refresh: () => {
            if (!mounted)
              return lastResult;
            lastResult = render();
            return lastResult;
          },
          unmount: () => {
            if (!mounted)
              return;
            mounted = false;
            generation++;
            localState.clear();
            unsubscribe();
            container.remove();
          },
          getLastResult: () => cloneResult(lastResult)
        }
      };
    }
    #render(surfaceId, container, document2, generation, isCurrent, requestRefresh, localState, renderedIdentities, controlMetadata, controls, appliedThemeProperties) {
      const resolved = this.#runtime.resolveSurface(surfaceId);
      if (!resolved.ok)
        return { ok: false, error: { code: "SURFACE_RESOLUTION_FAILED", cause: resolved.error } };
      const theme = this.#resolveTheme(resolved.value);
      if (!theme.ok)
        return theme;
      const attribution = this.#resolveAttribution(resolved.value, document2);
      if (!attribution.ok)
        return attribution;
      let renderedNode;
      const ready = resolved.value.tree.ready && resolved.value.tree.root !== void 0;
      if (ready) {
        const rendered = this.#renderTree(resolved.value, document2, generation, isCurrent, requestRefresh, localState, renderedIdentities, controlMetadata, controls);
        if (!rendered.ok)
          return rendered;
        renderedNode = rendered.value;
      }
      applyThemeProperties(container, appliedThemeProperties, theme.value);
      container.replaceChildren(...[
        attribution.value,
        renderedNode
      ].filter((node) => node !== void 0));
      return { ok: true, value: { ready } };
    }
    #resolveAttribution(surface, document2) {
      if (this.#attributionProvider === void 0)
        return { ok: true, value: void 0 };
      let result;
      try {
        result = this.#attributionProvider(Object.freeze({
          surfaceId: surface.surfaceId,
          catalogId: surface.catalogId,
          theme: surface.theme === void 0 ? void 0 : structuredClone(surface.theme)
        }));
      } catch {
        return { ok: false, error: { code: "ATTRIBUTION_PROVIDER_FAILED" } };
      }
      if (result === void 0)
        return { ok: true, value: void 0 };
      if (result === null || typeof result !== "object" || typeof result.displayName !== "string" || result.displayName.trim() === "" || "iconUrl" in result && typeof result.iconUrl !== "string") {
        return { ok: false, error: { code: "INVALID_VERIFIED_ATTRIBUTION" } };
      }
      const verified = result;
      const chrome = document2.createElement("div");
      chrome.setAttribute("data-weaver-surface-attribution", "");
      chrome.style.display = "flex";
      chrome.style.alignItems = "center";
      chrome.style.gap = "var(--a2ui-space, 8px)";
      chrome.style.marginBottom = "var(--a2ui-space, 8px)";
      if (verified.iconUrl !== void 0) {
        const icon = document2.createElement("img");
        icon.alt = "";
        icon.width = 24;
        icon.height = 24;
        icon.style.objectFit = "contain";
        icon.src = verified.iconUrl;
        chrome.append(icon);
      }
      const name = document2.createElement("span");
      name.textContent = verified.displayName;
      chrome.append(name);
      return { ok: true, value: chrome };
    }
    #resolveTheme(surface) {
      if (this.#themeAdapter === void 0)
        return { ok: true, value: {} };
      try {
        const result = this.#themeAdapter(Object.freeze({
          catalogId: surface.catalogId,
          theme: surface.theme === void 0 ? void 0 : structuredClone(surface.theme)
        }));
        if (result === null || typeof result !== "object" || result.customProperties === null || typeof result.customProperties !== "object" || Array.isArray(result.customProperties))
          return { ok: false, error: { code: "THEME_ADAPTER_FAILED" } };
        const properties = {};
        for (const [name, value] of Object.entries(result.customProperties)) {
          if (!/^--[A-Za-z_][A-Za-z0-9_-]*$/.test(name) || typeof value !== "string") {
            return { ok: false, error: { code: "THEME_ADAPTER_FAILED" } };
          }
          properties[name] = value;
        }
        return { ok: true, value: properties };
      } catch {
        return { ok: false, error: { code: "THEME_ADAPTER_FAILED" } };
      }
    }
    #renderTree(surface, document2, generation, isCurrent, requestRefresh, localState, renderedIdentities, controlMetadata, controls) {
      const checks = /* @__PURE__ */ new Map();
      for (const snapshot of surface.checks.components) {
        checks.set(identityKey(snapshot.sourceComponentId, snapshot.scopePath), snapshot);
      }
      return this.#renderInstance(surface.surfaceId, surface.catalogId, surface.tree.root, checks, document2, generation, isCurrent, requestRefresh, localState, renderedIdentities, controlMetadata, controls);
    }
    #renderInstance(surfaceId, catalogId, instance, checks, document2, generation, isCurrent, requestRefresh, localState, renderedIdentities, controlMetadata, controls) {
      const instanceIdentity = identityKey(instance.sourceComponentId, instance.scopePath);
      renderedIdentities.add(instanceIdentity);
      const relationships = [];
      for (const relationship of instance.relationships) {
        if (relationship.kind === "single") {
          if (relationship.child === void 0) {
            relationships.push({
              kind: "single",
              property: relationship.property,
              location: relationship.location.map((segment) => ({ ...segment }))
            });
            continue;
          }
          const child = this.#renderInstance(surfaceId, catalogId, relationship.child, checks, document2, generation, isCurrent, requestRefresh, localState, renderedIdentities, controlMetadata, controls);
          if (!child.ok)
            return child;
          relationships.push({
            kind: "single",
            property: relationship.property,
            location: relationship.location.map((segment) => ({ ...segment })),
            child: child.value,
            childComponent: relationship.child.component,
            childProperties: cloneHydratedProperties(relationship.child.properties)
          });
          continue;
        }
        const children = [];
        const childComponents = [];
        const childProperties = [];
        for (const childInstance of relationship.children) {
          const child = this.#renderInstance(surfaceId, catalogId, childInstance, checks, document2, generation, isCurrent, requestRefresh, localState, renderedIdentities, controlMetadata, controls);
          if (!child.ok)
            return child;
          children.push(child.value);
          childComponents.push(childInstance.component);
          childProperties.push(cloneHydratedProperties(childInstance.properties));
        }
        relationships.push({
          kind: relationship.kind,
          property: relationship.property,
          location: relationship.location.map((segment) => ({ ...segment })),
          children,
          childComponents,
          childProperties
        });
      }
      const renderer = this.#renderers.get(catalogId, instance.component);
      const metadata = { catalogId, component: instance.component, sourceComponentId: instance.sourceComponentId, scopePath: instance.scopePath };
      if (renderer === void 0)
        return { ok: false, error: { code: "RENDERER_NOT_FOUND", ...metadata } };
      const renderedState = cloneStateEntries(localState.get(instanceIdentity));
      const interactions = {
        writeInput: (property, value) => {
          if (!isCurrent())
            return { ok: false, error: { code: "STALE_RENDER_INTERACTION" } };
          return this.#runtime.writeInput({ surfaceId, sourceComponentId: instance.sourceComponentId, scopePath: instance.scopePath, property, value });
        },
        getLocalState: (key3, fallback2) => cloneJsonValue(renderedState.get(key3) ?? fallback2),
        setLocalState: (key3, value) => {
          if (!isCurrent())
            return { ok: false, error: { code: "STALE_RENDER_INTERACTION" } };
          if (!isJsonValue2(value))
            return { ok: false, error: { code: "INVALID_LOCAL_STATE_VALUE" } };
          let state = localState.get(instanceIdentity);
          if (state === void 0) {
            state = /* @__PURE__ */ new Map();
            localState.set(instanceIdentity, state);
          }
          state.set(key3, cloneJsonValue(value));
          requestRefresh();
          return { ok: true };
        },
        registerControl: (element, localKey) => {
          const identity = controlIdentityKey(instance.sourceComponentId, instance.scopePath, localKey);
          controlMetadata.set(element, identity);
          controls.set(identity, element);
        },
        dispatchAction: (actionProperty) => {
          if (!isCurrent())
            return { ok: false, error: { code: "STALE_RENDER_INTERACTION" } };
          const result = this.#runtime.dispatchAction({ surfaceId, sourceComponentId: instance.sourceComponentId, scopePath: instance.scopePath, actionProperty });
          if (result.ok && result.value.kind === "serverEvent" && this.#onServerEvent !== void 0) {
            try {
              this.#onServerEvent(structuredClone({ message: result.value.message, ...result.value.metadata === void 0 ? {} : { metadata: result.value.metadata } }));
            } catch {
              return { ok: false, error: { code: "SERVER_EVENT_HANDOFF_FAILED" } };
            }
          }
          return result;
        }
      };
      let node;
      try {
        node = renderer({ document: document2, surfaceId, catalogId, instance, properties: Object.freeze({ ...instance.properties }), relationships: Object.freeze(relationships), checks: checks.get(instanceIdentity), interactions });
      } catch {
        return { ok: false, error: { code: "RENDERER_EXECUTION_FAILED", ...metadata } };
      }
      if (!isNode(node, document2))
        return { ok: false, error: { code: "INVALID_RENDERER_RESULT", ...metadata } };
      return { ok: true, value: node };
    }
  };
  function applyThemeProperties(container, applied, next) {
    for (const name of applied)
      if (!(name in next))
        container.style.removeProperty(name);
    for (const [name, value] of Object.entries(next))
      container.style.setProperty(name, value);
    applied.clear();
    for (const name of Object.keys(next))
      applied.add(name);
  }
  function cloneHydratedProperties(properties) {
    return structuredClone(properties);
  }
  function cloneStateEntries(state) {
    const clone = /* @__PURE__ */ new Map();
    if (state !== void 0)
      for (const [key3, value] of state)
        clone.set(key3, cloneJsonValue(value));
    return clone;
  }
  function cloneJsonValue(value) {
    return structuredClone(value);
  }
  function isJsonValue2(value, seen = /* @__PURE__ */ new Set()) {
    if (value === null || typeof value === "string" || typeof value === "boolean")
      return true;
    if (typeof value === "number")
      return Number.isFinite(value);
    if (typeof value !== "object" || seen.has(value))
      return false;
    seen.add(value);
    let valid;
    if (Array.isArray(value))
      valid = value.every((entry) => isJsonValue2(entry, seen));
    else {
      const prototype = Object.getPrototypeOf(value);
      valid = (prototype === Object.prototype || prototype === null) && Object.values(value).every((entry) => isJsonValue2(entry, seen));
    }
    seen.delete(value);
    return valid;
  }
  function isNode(value, document2) {
    const NodeConstructor = document2.defaultView?.Node;
    if (NodeConstructor !== void 0)
      return value instanceof NodeConstructor;
    if (typeof value !== "object" && typeof value !== "function" || value === null)
      return false;
    const probe = document2.createDocumentFragment();
    return Object.getPrototypeOf(probe).isPrototypeOf(value);
  }
  function captureFocus(container, document2, metadata) {
    const active = document2.activeElement;
    if (active === null || !container.contains(active))
      return void 0;
    const identity = metadata.get(active);
    if (identity === void 0)
      return void 0;
    const snapshot = { identity };
    try {
      const control = active;
      if (typeof control.selectionStart === "number" && typeof control.selectionEnd === "number") {
        snapshot.start = control.selectionStart;
        snapshot.end = control.selectionEnd;
        if (control.selectionDirection !== null)
          snapshot.direction = control.selectionDirection;
      }
    } catch {
    }
    return snapshot;
  }
  function restoreFocus(snapshot, controls) {
    if (snapshot === void 0)
      return;
    const replacement = controls.get(snapshot.identity);
    if (replacement === void 0 || !("focus" in replacement))
      return;
    const focusable = replacement;
    try {
      focusable.focus({ preventScroll: true });
    } catch {
      return;
    }
    if (snapshot.start === void 0 || snapshot.end === void 0)
      return;
    try {
      replacement.setSelectionRange(snapshot.start, snapshot.end, snapshot.direction);
    } catch {
    }
  }
  function cloneResult(result) {
    return result.ok ? { ok: true, value: { ...result.value } } : structuredClone(result);
  }

  // node_modules/@weaver/web/dist/basic-web-runtime/createBasicWebRuntime.js
  function createBasicWebRuntime(config = {}) {
    const catalogId = A2UI_V091_BASIC_CATALOG_ID;
    const runtimeCreated = createWeaverRuntime({
      ...config.runtime,
      catalogs: [createBasicCatalogV091Registration(), ...config.additionalCatalogs ?? []]
    });
    if (!runtimeCreated.ok)
      return runtimeCreated;
    const basic = config.basic;
    const registrations = [
      ...createBasicCatalogRendererRegistrations({
        catalogId,
        ...basic?.resourcePolicy === void 0 ? {} : { resourcePolicy: basic.resourcePolicy },
        ...basic?.iconResolver === void 0 ? {} : { iconResolver: basic.iconResolver },
        ...basic?.regexMatcher === void 0 ? {} : { regexMatcher: basic.regexMatcher },
        ...basic?.dateTimeInputLocalValueResolver === void 0 ? {} : { dateTimeInputLocalValueResolver: basic.dateTimeInputLocalValueResolver }
      }),
      ...config.additionalRenderers ?? []
    ];
    let renderers;
    try {
      renderers = new RendererRegistry(registrations);
    } catch (error2) {
      if (error2 instanceof RendererRegistryConfigurationError) {
        return { ok: false, error: { code: "RENDERER_CONFIGURATION_FAILED", rendererError: error2 } };
      }
      throw error2;
    }
    const surface = new WebSurfaceRenderer({
      runtime: runtimeCreated.value,
      renderers,
      themeAdapter: createBasicCatalogThemeAdapter({ catalogId }),
      ...config.rendering?.attributionProvider === void 0 ? {} : { attributionProvider: config.rendering.attributionProvider },
      ...config.rendering?.onServerEvent === void 0 ? {} : { onServerEvent: config.rendering.onServerEvent }
    });
    const runtime = runtimeCreated.value;
    const facade = {
      catalogId,
      runtime,
      mount: (options) => surface.mount(options)
    };
    return { ok: true, value: facade };
  }

  // apps/local-guest/src/conversational-shell.ts
  function createConversationShellState() {
    return { historicalSummaries: [], focusedSurfaceOpen: false };
  }
  function replaceActiveSurface(state, next) {
    const current = state.activeSurface;
    const shouldRecordCurrent = current !== void 0 && current.surfaceId !== next.surfaceId;
    const historicalSummary = shouldRecordCurrent ? {
      surfaceId: current.surfaceId,
      status: "superseded",
      summary: current.summary
    } : void 0;
    return {
      activeSurface: next,
      historicalSummaries: historicalSummary === void 0 ? state.historicalSummaries : [...state.historicalSummaries, historicalSummary],
      focusedSurfaceOpen: next.mode === "focused-surface" && next.status === "active"
    };
  }
  function closeFocusedSurface(state) {
    if (state.activeSurface?.mode !== "focused-surface") return state;
    return { ...state, focusedSurfaceOpen: false };
  }
  function reopenFocusedSurface(state) {
    if (state.activeSurface?.mode !== "focused-surface" || state.activeSurface.status !== "active") return state;
    return { ...state, focusedSurfaceOpen: true };
  }
  function markActiveSurfaceStatus(state, status) {
    if (!state.activeSurface) return state;
    return {
      ...state,
      activeSurface: { ...state.activeSurface, status },
      focusedSurfaceOpen: false
    };
  }
  function canUseSurfaceActions(status) {
    return status === "active";
  }
  function fallbackSummary(surface) {
    if (surface.status === "fallback") return surface.summary;
    if (surface.status === "stale") return "This workspace is out of date. Refresh to continue.";
    if (surface.status === "expired") return "This workspace has expired. Refresh to continue.";
    if (surface.status === "deleted") return "This workspace is no longer available.";
    if (surface.status === "superseded") return "This workspace has been replaced by a newer one.";
    return surface.summary;
  }

  // apps/local-guest/src/client.ts
  function requiredElement(id) {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing guest shell element: ${id}`);
    return element;
  }
  var transcript = requiredElement("transcript");
  var workspaceRegion = requiredElement("workspace-region");
  var activeWorkspace = requiredElement("active-workspace");
  var workspaceReopen = requiredElement("workspace-reopen");
  var composerForm = requiredElement("composer");
  var composerInput = requiredElement("composer-input");
  var composerSubmit = requiredElement("composer-submit");
  var announcer = requiredElement("announcer");
  function getThreadId() {
    try {
      const urlParam = new URLSearchParams(window.location.search).get("threadId");
      if (urlParam && /^g-[a-f0-9-]{6,64}$/.test(urlParam)) {
        window.sessionStorage.setItem("shortlet-concierge-thread", urlParam);
        return urlParam;
      }
      const stored = window.sessionStorage.getItem("shortlet-concierge-thread");
      if (stored && /^g-[a-f0-9-]{6,64}$/.test(stored)) return stored;
    } catch {
    }
    const created2 = `g-${crypto.randomUUID()}`;
    try {
      window.sessionStorage.setItem("shortlet-concierge-thread", created2);
    } catch {
    }
    return created2;
  }
  function isRecord3(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  function isSafeImageUrl(value) {
    try {
      const parsed = new URL(value);
      const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
      if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "") return false;
      if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith(".lan")) return false;
      if (hostname.includes(":") || hostname.startsWith("[")) return false;
      if (/^(0\.|10\.|127\.|169\.254\.|192\.0\.0\.|192\.168\.|198\.(18|19)\.|224\.)/.test(hostname)) return false;
      if (/^100\.(6[4-9]|[78]\d|9\d)\./.test(hostname)) return false;
      if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return false;
      if (hostname === "::1" || hostname.startsWith("fc") || hostname.startsWith("fd") || hostname.startsWith("fe8")) return false;
      return true;
    } catch {
      return false;
    }
  }
  function enhanceListingImages(mount) {
    for (const [index, image] of [...mount.querySelectorAll("img")].entries()) {
      image.referrerPolicy = "no-referrer";
      image.decoding = "async";
      image.loading = index === 0 ? "eager" : "lazy";
      image.addEventListener("error", () => {
        const fallback2 = document.createElement("div");
        fallback2.className = "photo-fallback";
        fallback2.setAttribute("role", "img");
        fallback2.setAttribute("aria-label", `${image.alt || "Listing photo"} unavailable`);
        fallback2.textContent = "Photo unavailable";
        image.replaceWith(fallback2);
      }, { once: true });
    }
  }
  function isSafeInternalRoute(value) {
    if (typeof value !== "string" || value === "" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return false;
    try {
      return new URL(value, window.location.origin).origin === window.location.origin;
    } catch {
      return false;
    }
  }
  function isSurfacePayload(value) {
    if (!isRecord3(value) || typeof value.surfaceId !== "string" || value.surfaceId.trim() === "" || !Array.isArray(value.a2uiMessages)) return false;
    if (value.mode !== void 0 && value.mode !== "text" && value.mode !== "inline-surface" && value.mode !== "focused-surface") return false;
    if (value.status !== void 0 && (typeof value.status !== "string" || !["active", "superseded", "stale", "expired", "deleted", "fallback"].includes(value.status))) return false;
    if (value.summary !== void 0 && typeof value.summary !== "string") return false;
    if (value.textFallback !== void 0 && typeof value.textFallback !== "string") return false;
    return value.conventionalRoute === void 0 || isSafeInternalRoute(value.conventionalRoute);
  }
  function readGuestResponse(value) {
    if (!isRecord3(value) || typeof value.ok !== "boolean") throw new Error("Invalid server response");
    if (value.messages !== void 0 && (!Array.isArray(value.messages) || value.messages.some((message) => typeof message !== "string"))) throw new Error("Invalid response messages");
    if (value.surfaces !== void 0 && (!Array.isArray(value.surfaces) || value.surfaces.some((surface) => !isSurfacePayload(surface)))) throw new Error("Invalid response surface");
    return value;
  }
  var threadId = getThreadId();
  var shellState = createConversationShellState();
  var activePayload;
  var isLoading = false;
  function trackTelemetry(event) {
    void fetch("/api/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event }),
      keepalive: true
    }).catch(() => {
    });
  }
  function announce(text, assertive = false) {
    announcer.setAttribute("aria-live", assertive ? "assertive" : "polite");
    announcer.textContent = text;
  }
  function addTurn(role, text) {
    const turn = document.createElement("article");
    turn.className = `turn ${role}`;
    turn.setAttribute("aria-label", role === "user" ? "You" : "Shortlet Concierge");
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = text;
    turn.appendChild(bubble);
    transcript.appendChild(turn);
    transcript.scrollTop = transcript.scrollHeight;
  }
  function addHistoricalSummary(summary) {
    const item = document.createElement("div");
    item.className = "historical-summary";
    item.setAttribute("role", "status");
    item.textContent = `${summary.summary} \xB7 ${summary.status}`;
    transcript.appendChild(item);
  }
  function modeFor(surface) {
    if (surface.mode) return surface.mode;
    return surface.surfaceId.includes(":unit:") || surface.surfaceId.includes(":request:") || surface.surfaceId.includes(":offer:") || surface.surfaceId.includes(":booking:") || surface.surfaceId.includes(":payment:") ? "focused-surface" : "inline-surface";
  }
  function presentationFor(surface) {
    const mode = modeFor(surface);
    return {
      surfaceId: surface.surfaceId,
      mode,
      // Missing authority metadata is unsafe: the browser must not infer that
      // a rich surface is actionable (ADR-0074).
      status: surface.status ?? "fallback",
      summary: surface.summary ?? (mode === "focused-surface" ? "Focused workspace" : "Conversation workspace"),
      ...surface.textFallback === void 0 ? {} : { textFallback: surface.textFallback },
      ...surface.conventionalRoute === void 0 ? {} : { conventionalRoute: surface.conventionalRoute }
    };
  }
  function fallback(mount, surface) {
    mount.replaceChildren();
    const box = document.createElement("div");
    box.className = "surface-fallback";
    box.setAttribute("role", "alert");
    const text = document.createElement("p");
    text.textContent = surface.textFallback ?? fallbackSummary(surface);
    box.appendChild(text);
    if (surface.conventionalRoute) {
      const link = document.createElement("a");
      link.href = surface.conventionalRoute;
      link.className = "fallback-link";
      link.textContent = "Continue on the standard page";
      box.appendChild(link);
      trackTelemetry("conventional-route-fallback");
    }
    mount.appendChild(box);
  }
  function showReopen() {
    const current = shellState.activeSurface;
    const canReopen = current?.mode === "focused-surface" && current.status === "active" && activePayload !== void 0;
    workspaceReopen.hidden = !canReopen || shellState.focusedSurfaceOpen;
    if (canReopen) workspaceReopen.textContent = `Reopen ${current.summary}`;
  }
  function renderSurface(surface) {
    const presentation = presentationFor(surface);
    activePayload = surface;
    activeWorkspace.replaceChildren();
    activeWorkspace.hidden = false;
    activeWorkspace.tabIndex = -1;
    workspaceRegion.hidden = false;
    activeWorkspace.dataset.mode = presentation.mode;
    activeWorkspace.dataset.status = presentation.status;
    const heading = document.createElement("div");
    heading.className = "workspace-heading";
    const headingText = document.createElement("div");
    headingText.className = "workspace-heading-text";
    const eyebrow = document.createElement("span");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = "Current workspace";
    const title = document.createElement("strong");
    title.textContent = presentation.summary;
    headingText.append(eyebrow, title);
    heading.appendChild(headingText);
    if (presentation.mode === "focused-surface") {
      const close = document.createElement("button");
      close.type = "button";
      close.className = "workspace-close";
      close.textContent = "Back to conversation";
      close.addEventListener("click", () => {
        shellState = closeFocusedSurface(shellState);
        activeWorkspace.hidden = true;
        showReopen();
        workspaceReopen.focus();
        trackTelemetry("focused-surface-closed");
        announce("Focused workspace closed. Conversation context preserved.");
      });
      heading.appendChild(close);
    }
    activeWorkspace.appendChild(heading);
    const state = document.createElement("p");
    state.className = `workspace-status status-${presentation.status}`;
    state.textContent = presentation.status === "active" ? "Ready for your next action." : fallbackSummary(presentation);
    activeWorkspace.appendChild(state);
    const mount = document.createElement("div");
    mount.className = "weaver-mount";
    mount.setAttribute("aria-label", presentation.summary);
    activeWorkspace.appendChild(mount);
    if (presentation.status === "stale") trackTelemetry("stale-surface-encountered");
    if (presentation.status === "expired") trackTelemetry("expired-surface-encountered");
    if (!canUseSurfaceActions(presentation.status)) {
      mount.setAttribute("inert", "");
      mount.setAttribute("aria-disabled", "true");
    }
    if (presentation.status === "fallback") {
      trackTelemetry("fallback-rendered");
      fallback(mount, presentation);
      showReopen();
      return;
    }
    for (const message of surface.a2uiMessages) {
      const processed = weaver.runtime.process(message);
      if (!processed.ok) {
        trackTelemetry("weaver-rendering-failure");
        trackTelemetry("fallback-rendered");
        fallback(mount, { ...presentation, status: "fallback" });
        announce("The workspace could not be displayed safely. A standard route remains available.", true);
        showReopen();
        return;
      }
    }
    const mounted = weaver.mount({ surfaceId: surface.surfaceId, target: mount });
    if (!mounted.ok) {
      trackTelemetry("weaver-rendering-failure");
      trackTelemetry("fallback-rendered");
      fallback(mount, { ...presentation, status: "fallback" });
      announce("The workspace could not be displayed safely. A standard route remains available.", true);
      showReopen();
      return;
    }
    enhanceListingImages(mount);
    showReopen();
    activeWorkspace.scrollIntoView({ block: "nearest" });
    activeWorkspace.focus({ preventScroll: true });
    trackTelemetry(presentation.mode === "focused-surface" ? "focused-surface-opened" : "inline-surface-rendered");
    announce(`${presentation.summary} is ready.`);
  }
  function acceptSurface(surface) {
    const before = shellState.historicalSummaries.length;
    const replaced = shellState.activeSurface !== void 0 && shellState.activeSurface.surfaceId !== surface.surfaceId;
    shellState = replaceActiveSurface(shellState, presentationFor(surface));
    if (replaced) trackTelemetry("surface-replaced");
    for (const summary of shellState.historicalSummaries.slice(before)) addHistoricalSummary(summary);
    renderSurface(surface);
  }
  function renderSurfaces(surfaces) {
    for (const historical of surfaces.slice(0, -1)) {
      const presentation = presentationFor(historical);
      addHistoricalSummary({ surfaceId: historical.surfaceId, status: "superseded", summary: presentation.summary });
    }
    const current = surfaces.at(-1);
    if (current) acceptSurface(current);
  }
  function renderResponse(response) {
    if (!response.ok) {
      const message = response.message ?? "That action could not be completed.";
      if (response.code === "STALE_SURFACE" || response.code === "STALE_ACTION" || response.code === "EXPIRED_SURFACE") {
        shellState = markActiveSurfaceStatus(shellState, response.code === "EXPIRED_SURFACE" ? "expired" : "stale");
        if (activePayload) renderSurface({ ...activePayload, status: shellState.activeSurface?.status });
        void refreshServerState();
      }
      addTurn("assistant", message);
      announce(message, true);
      return false;
    }
    for (const message of response.messages ?? []) addTurn("assistant", message);
    if ((response.messages ?? []).length > 0) trackTelemetry("text-response-rendered");
    const surfaces = response.surfaces ?? [];
    renderSurfaces(surfaces);
    return true;
  }
  async function refreshServerState() {
    try {
      const response = await postJson(`/api/state?threadId=${encodeURIComponent(threadId)}`);
      if (response.ok && response.surfaces && response.surfaces.length > 0) {
        renderSurfaces(response.surfaces);
      }
    } catch {
    }
  }
  async function postJson(path, body) {
    const response = await fetch(path, body === void 0 ? {} : {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    return readGuestResponse(await response.json());
  }
  function setLoading(next) {
    isLoading = next;
    composerInput.disabled = next;
    composerSubmit.disabled = next;
    composerForm.setAttribute("aria-busy", String(next));
    composerSubmit.textContent = next ? "Sending\u2026" : "Send";
    if (next) announce("Sending your message\u2026");
  }
  async function sendTurn(text) {
    if (isLoading) return;
    setLoading(true);
    try {
      if (renderResponse(await postJson("/api/turn", { threadId, text }))) {
        composerInput.value = "";
        composerInput.focus();
      }
    } catch {
      addTurn("assistant", "The concierge is temporarily unavailable. Your message is still in the composer; please try again.");
      announce("The concierge is temporarily unavailable. Your message remains in the composer.", true);
    } finally {
      setLoading(false);
    }
  }
  async function sendEvent(action) {
    const current = shellState.activeSurface;
    if (!current || current.surfaceId !== action.surfaceId || !canUseSurfaceActions(current.status)) {
      addTurn("assistant", fallbackSummary(current ?? { surfaceId: action.surfaceId, mode: "inline-surface", status: "stale", summary: "This workspace" }));
      announce("That action is no longer available. The workspace has been kept safe.", true);
      return;
    }
    try {
      renderResponse(await postJson("/api/event", { threadId, ...action }));
    } catch {
      addTurn("assistant", "The action could not be sent. Please try again.");
      announce("The action could not be sent. Please try again.", true);
    }
  }
  var created = createBasicWebRuntime({
    basic: {
      resourcePolicy: ({ kind, url }) => kind === "image" && isSafeImageUrl(url) ? url : void 0
    },
    rendering: { onServerEvent: (event) => {
      void sendEvent(event.message.action);
    } }
  });
  if (!created.ok) {
    addTurn("assistant", "The interface runtime could not start. Please reload the page.");
    announce("The interface runtime could not start. Please reload the page.", true);
    throw new Error("Unable to create the Weaver web runtime");
  }
  var weaver = created.value;
  workspaceReopen.addEventListener("click", () => {
    shellState = reopenFocusedSurface(shellState);
    if (activePayload) renderSurface(activePayload);
  });
  composerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = composerInput.value.trim();
    if (text === "" || isLoading) return;
    addTurn("user", text);
    void sendTurn(text);
  });
  async function restoreServerState() {
    try {
      const response = await postJson(`/api/state?threadId=${encodeURIComponent(threadId)}`);
      if (!response.ok || !response.timeline || response.timeline.length === 0) return false;
      for (const entry of response.timeline) addTurn(entry.role, entry.text);
      renderSurfaces(response.surfaces ?? []);
      announce("Your conversation has been restored.");
      return true;
    } catch {
      return false;
    }
  }
  void restoreServerState().then((restored) => {
    if (!restored) addTurn("assistant", "Hi! I'm the Shortlet concierge. Tell me where you'd like to stay, for how long, and how many guests \u2014 for example: \u201CI need an apartment in Ikoyi for 3 nights for 2 people\u201D.");
  });
})();
