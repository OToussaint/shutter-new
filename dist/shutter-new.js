/**
 * Get the base URL for loading component resources (translations, etc.)
 * Works with both development (relative paths) and HACS deployment
 */
function getComponentBaseUrl() {
  // Try to find the script URL from document's scripts
  const scripts = document.querySelectorAll('script');
  for (const script of scripts) {
    if (script.src && (script.src.includes('shutter-new.js') || script.src.includes('shutter-new'))) {
      // Extract directory from script URL
      const url = new URL(script.src, window.location.href);
      return url.pathname.substring(0, url.pathname.lastIndexOf('/'));
    }
  }
  // Fallback: assume standard HACS path
  return '/hacsfiles/shutter-new';
}

/**
 * Shared translation loader utility
 * Loads translations from local JSON files based on language code
 * Returns promise that resolves to translations object
 */
async function loadTranslations(lang) {
  try {
    console.log('[loadTranslations] Starting for lang:', lang);
    // Map language code to file (e.g., 'en-GB' -> 'en.json')
    const langFile = lang.split('-')[0].toLowerCase();
    const baseUrl = getComponentBaseUrl();
    const filePath = `${baseUrl}/translations/${langFile}.json`;
    console.log('[loadTranslations] Fetching from:', filePath);
    
    const response = await fetch(filePath);
    if (!response.ok) {
      console.warn('[loadTranslations] Response not ok, falling back to English');
      // Fall back to English if requested language not found
      const fallbackPath = `${baseUrl}/translations/en.json`;
      const fallbackResponse = await fetch(fallbackPath);
      if (!fallbackResponse.ok) throw new Error('Failed to load translations');
      const data = await fallbackResponse.json();
      console.log('[loadTranslations] Fallback data loaded:', data);
      return data.shutter_new || {};
    }
    const data = await response.json();
    console.log('[loadTranslations] Data loaded for', langFile + ':', data);
    const result = data.shutter_new || {};
    console.log('[loadTranslations] Returning shutter_new object:', result);
    return result;
  } catch (error) {
    console.error('[loadTranslations] Error:', error);
    return {}; // Empty object as last resort
  }
}

/**
 * ShutterNew: A custom Home Assistant Lovelace card for controlling roller shutters
 * Features: compact 100x100px visual representation, drag-to-control, keyboard buttons,
 * favorites support, and configurable hidden controls
 */
class ShutterNew extends HTMLElement {
  constructor() {
    super();
    // Use Shadow DOM for style isolation and encapsulation
    this.attachShadow({ mode: 'open' });
    // Track current shutter position (0-100%, 0=closed, 100=open)
    this._position = 0;
    // Flag to prevent HA state overwriting user's manual drag
    this._isDragging = false;
    // Translations storage and loading state
    this._translations = {};
    this._translationsLoaded = false;
    // Load translations immediately from browser language
    this._initTranslations();
  }

  /**
   * Initialize translations from browser language or HA language later
   */
  _initTranslations() {
    // Try to get language from browser
    const browserLang = navigator.language || navigator.userLanguage || 'en';
    loadTranslations(browserLang).then(translations => {
      this._translations = translations;
      this._translationsLoaded = true;
      // FORCE re-render with new translations
      this._render();
    }).catch(err => {
      console.error('[ShutterNew._initTranslations] Error loading translations:', err);
    });
  }

  /**
   * Lovelace integration: Tells the card editor UI which custom element to use
   * Required by Lovelace for the card configuration interface
   */
  static getConfigElement() {
    return document.createElement("shutter-new-editor");
  }

  /**
   * Lovelace integration: Provides default configuration for new card instances
   * Prevents errors when creating a card from scratch
   */
  static getStubConfig() {
    return {
      entity: "",              // Empty entity ID (must be set by user)
      name: "",                // Falls back to entity's friendly_name if not set
      favorite: 50,            // Default favorite position: 50%
      hide: [],                // All controls visible by default
      position: "left"         // Buttons position: "left" or "right" (default: "left")
    };
  }

  /**
   * Receives card configuration from Lovelace when card is created/updated
   * Merges user config with defaults and validates required fields
   */
  setConfig(config) {
    // Entity ID (cover domain) is mandatory
    if (!config.entity) {
      throw new Error("Please set an 'entity' (e.g., cover.living_room)");
    }
    // Merge config with defaults, allowing user settings to override
    this._config = {
      favorite: 50, // Default favorite position if not specified
      hide: [],     // Default to showing all controls
      ...config     // User-provided settings override defaults
    };
  }

  /**
   * Home Assistant updates: Called whenever any state in HA changes
   * Updates internal position and re-renders if state differs from local
   * Key design: doesn't overwrite position if user is actively dragging
   */
  set hass(hass) {
    // If HA language is different from what we loaded, reload translations
    const haLang = hass.language || 'en';
    if (this._translations && !this._translations['open']) {
      // Translations not loaded yet, load with HA language
      loadTranslations(haLang).then(translations => {
        this._translations = translations;
        this._translationsLoaded = true;
        this._updateDom();
      });
      this._hass = hass;
      return;
    }

    this._hass = hass;
    const entityId = this._config.entity;
    const stateObj = hass.states[entityId];

    // Entity not found - show error and exit
    if (!stateObj) {
      this._renderError(`Entity not found: ${entityId}`);
      return;
    }

    // Extract position from HA state or attributes
    // Preferred: current_position attribute (0-100)
    // Fallback: infer from state (closed=0, other=100)
    const haPosition = stateObj.attributes.current_position !== undefined
      ? stateObj.attributes.current_position
      : (stateObj.state === 'closed' ? 0 : 100);

    // State can be: 'opening', 'closing', 'open', 'closed'
    const haState = stateObj.state;

    // Critical: only sync position from HA if user is NOT actively dragging
    // This prevents the drag from being interrupted by HA feedback
    if (!this._isDragging) {
      this._position = haPosition;
    }

    this._haState = haState;
    // Use custom name if configured, otherwise use HA entity's friendly name
    this._entityName = this._config.name || stateObj.attributes.friendly_name || entityId;

    // Update visual representation
    this._updateDom();
  }

  /**
   * Web Component lifecycle: Called when element is inserted into DOM
   * Initializes the card UI and attaches event listeners
   */
  connectedCallback() {
    this._render();           // Generate and insert HTML/CSS
    this._setupListeners();   // Attach click, drag, and touch handlers
  }

  /**
   * Utility: Get translated text from local translation files
   * Falls back to English version if translation key not found
   * Format: key should be like 'open', 'close', 'stop', etc.
   */
  _localize(key, fallback = '') {
    // Return from local translations if available
    if (this._translations && this._translations[key]) {
      return this._translations[key];
    }
    // Fallback to English string if translation not found
    return fallback || key;
  }

  /**
   * Main render function: Generates the card's HTML/CSS structure
   * Creates a responsive grid layout based on which controls are visible
   * Uses template literals to build the Shadow DOM content
   */
  _render() {
    // Parse visibility config: determine which buttons to show
    const hideList = this._config.hide || [];
    const showFavorite = !hideList.includes('favorite');
    const showUp = !hideList.includes('up');
    const showStop = !hideList.includes('stop');
    const showDown = !hideList.includes('down');

    // Get translated button labels (from local translation files)
    const labelOpen = this._localize('open', 'Open');
    const labelStop = this._localize('stop', 'Stop');
    const labelClose = this._localize('close', 'Close');
    const labelFavorite = this._localize('favorite', 'Favorite');

    // Determine grid structure based on which columns contain controls
    // Column 1: Favorite button (if shown)
    // Column 2: Up/Stop/Down buttons (if any shown)
    const hasCol1 = showFavorite;
    const hasCol2 = showUp || showStop || showDown;

    // Calculate CSS grid columns: 0px, 28px, or '28px 28px' depending on visibility
    let gridTemplateColumns = '0px';
    if (hasCol1 && hasCol2) {
      gridTemplateColumns = '28px 28px';  // Both columns visible
    } else if (hasCol1 || hasCol2) {
      gridTemplateColumns = '28px';       // Only one column
    }

    // Dynamically assign row indices to pack buttons vertically (remove gaps if hidden)
    // This ensures Up/Stop/Down buttons don't leave empty rows when hidden
    let nextRowIndex = 1;
    const upRow = showUp ? nextRowIndex++ : 0;      // 0 means 'don't place in grid'
    const stopRow = showStop ? nextRowIndex++ : 0;
    const downRow = showDown ? nextRowIndex++ : 0;

    // Determine which column (1 or 2) receives the control buttons
    const colForControls = hasCol1 ? 2 : 1;

    // Get position configuration (left or right)
    const buttonPosition = this._config.position || "left";
    const isPositionRight = buttonPosition === "right";

    // When position is right AND we have both columns, invert them
    const colForFavorite = (isPositionRight && hasCol2) ? 2 : 1;
    const colForControlsAdjusted = isPositionRight ? 1 : colForControls;

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
        }

        ha-card {
          background: transparent !important;
        }

        .shutter-title {
          font-family: var(--ha-font-family-body, inherit);
          font-size: var(--ha-font-size-xl, 16px);
          font-weight: var(--ha-font-weight-normal, 400);
          color: var(--secondary-text-color, #727272);
          line-height: var(--ha-line-height-normal, 24px);
          margin: 12px 16px 4px 16px;
          text-align: left;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* ===== LAYOUT STRUCTURE ===== */
        /* Main flexible centered container */
        .shutter-main-layout {
          display: flex;
          align-items: center;
          gap: 12px;
          justify-content: center;
          width: 100%;
        }

        /* Position right: inverse order (volet à gauche, boutons à droite) */
        .shutter-main-layout.position-right {
          flex-direction: row-reverse;
        }

        /* Adaptive grid depending on displayed buttons */
        /* Hidden if no controls are visible */
        .controls-grid {
          display: ${(!hasCol1 && !hasCol2) ? 'none' : 'grid'};
          grid-template-columns: ${gridTemplateColumns};
          grid-template-rows: repeat(3, 28px);
          gap: 6px;
        }

        /* ===== SHUTTER VISUAL REPRESENTATION ===== */
        /* Main container: 100x100px box showing shutter state */
        .shutter-container {
          position: relative;
          width: 100px;
          height: 100px;
          background: rgba(0, 0, 0, 0.01);
          border: 1px solid #d0d0d0;
          border-radius: 6px;
          overflow: hidden;
          flex-shrink: 0;
        }

        /* Top part: The roll-up caisson (where slats collect when opened) */
        .shutter-caisson {
          /* Fixed 15px height at top, represents the roll-up mechanism */
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 15px;
          background: linear-gradient(180deg, #f0f0f0 0%, #dcdcdc 40%, #b0b0b0 100%);
          border-bottom: 2px solid #888;
          box-shadow: 0 2px 3px rgba(0, 0, 0, 0.15);
          z-index: 15;
        }

        /* Container for shutter slats (occupies space below caisson) */
        .shutter-slats-wrapper {
          position: absolute;
          top: 15px;
          left: 0;
          right: 0;
          bottom: 0;
          overflow: hidden;
        }

        /* Visual representation of slats - height represents closed percentage */
        /* At 0%: full height (fully closed), at 100%: 0 height (fully open) */
        .shutter-content {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          /* Repeating gradient pattern creates the look of individual slats */
          background: repeating-linear-gradient(
            0deg,
            #a8a8a8 0px,
            #a8a8a8 2px,
            #c0c0c0 2px,
            #c0c0c0 6px
          );
          transition: height 0.3s ease;
          min-height: 8px;
        }

        /* Draggable handle: allows user to manually set shutter position */
        .shutter-handle {
          /* Positioned at bottom of slats area, centered horizontally */
          position: absolute;
          bottom: 1px;
          left: 50%;
          transform: translateX(-50%);
          width: 50%;
          height: 4px;
          background: #999;
          cursor: grab;
          z-index: 10;
          pointer-events: all;
          border-radius: 1px;
        }
        .shutter-handle:active {
          cursor: grabbing;
          background: #777;
        }

        /* Overlay shows during motion (opening/closing) or user dragging */
        .shutter-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.3);
          display: none;
          align-items: center;
          justify-content: center;
          z-index: 20;
          pointer-events: none;
          border-radius: 6px;
        }
        .shutter-overlay.active {
          display: flex;
        }

        /* Central display: shows motion icon or position percentage */
        .position-display {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: rgba(0, 0, 0, 0.75);
          color: white;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 21;
        }
        .position-display ha-icon {
          --mdc-icon-size: 20px;
        }
        .position-display span {
          font-size: 10px;
          font-weight: 600;
        }

        /* ===== CONTROL BUTTONS ===== */
        /* Unified appearance for all action buttons (Up/Stop/Down/Favorite) */
        .control-btn {
          width: 28px !important;
          height: 28px !important;
          padding: 0 !important;
          border: none !important;
          border-radius: 6px !important;
          background: transparent !important;
          cursor: pointer !important;
          color: var(--primary-text-color, #1f2937) !important;
          transition: all 0.2s !important;
          display: flex !important;
          justify-content: center !important;
          align-items: center !important;
          box-shadow: none !important;
        }

        .control-btn:hover {
          background: var(--secondary-background-color, rgba(0, 0, 0, 0.05)) !important;
        }

        .control-btn:active {
          transform: scale(0.95) !important;
        }

        /* Active state: button is highlighted when action is in progress */
        .control-btn.active {
          background: var(--primary-color, #03a9f4) !important;
          color: #ffffff !important;
          border-color: var(--primary-color, #03a9f4) !important;
        }

        /* Disabled state: shown when action is not possible (e.g., already open/closed) */
        .control-btn:disabled {
          opacity: 0.3 !important;
          cursor: not-allowed !important;
          pointer-events: none !important;
          background: transparent !important;
          color: var(--disabled-text-color, #a0a0a0) !important;
        }

        .control-btn ha-icon {
          --mdc-icon-size: 16px;
        }

        .error-card {
          color: var(--error-color, #db4437);
          padding: 8px;
          font-size: 12px;
          border: 1px solid var(--error-color, #db4437);
          border-radius: 8px;
          background: rgba(219, 68, 55, 0.1);
        }
      </style>

      <ha-card id="haCard">
        <div class="shutter-title" id="title">Chargement...</div>
        <div class="card-content">
          <div class="shutter-main-layout${isPositionRight ? ' position-right' : ''}">
            <div class="controls-grid">
              ${showFavorite ? `
                <button class="control-btn" id="favoriteBtn" title="${labelFavorite}" style="grid-column: ${colForFavorite}; grid-row: 1;">
                  <ha-icon icon="mdi:heart-outline"></ha-icon>
                </button>
              ` : ''}

              ${showUp ? `
                <button class="control-btn" id="upBtn" title="${labelOpen}" style="grid-column: ${colForControlsAdjusted}; grid-row: ${upRow};">
                  <ha-icon icon="mdi:arrow-up"></ha-icon>
                </button>
              ` : ''}

              ${showStop ? `
                <button class="control-btn" id="stopBtn" title="${labelStop}" style="grid-column: ${colForControlsAdjusted}; grid-row: ${stopRow};">
                  <ha-icon icon="mdi:stop"></ha-icon>
                </button>
              ` : ''}

              ${showDown ? `
                <button class="control-btn" id="downBtn" title="${labelClose}" style="grid-column: ${colForControlsAdjusted}; grid-row: ${downRow};">
                  <ha-icon icon="mdi:arrow-down"></ha-icon>
                </button>
              ` : ''}
            </div>

            <div class="shutter-container">
              <div class="shutter-caisson"></div>
              <div class="shutter-slats-wrapper" id="slatsWrapper">
                <div class="shutter-content" id="content">
                  <div class="shutter-handle" id="handle"></div>
                </div>
              </div>
              <div class="shutter-overlay" id="overlay">
                <div class="position-display" id="positionDisplay"></div>
              </div>
            </div>
          </div>
        </div>
      </ha-card>
    `;
  }

  /**
   * Setup: Attaches all interactive event listeners
   * Covers: button clicks, mouse/touch drag, document-level drag tracking
   */
  _setupListeners() {
    // Get references to interactive elements
    const handleEl = this.shadowRoot.getElementById('handle');
    const upBtn = this.shadowRoot.getElementById('upBtn');
    const stopBtn = this.shadowRoot.getElementById('stopBtn');
    const downBtn = this.shadowRoot.getElementById('downBtn');
    const favoriteBtn = this.shadowRoot.getElementById('favoriteBtn');
    const container = this.shadowRoot.getElementById('slatsWrapper');

    /* ===== BUTTON CLICK HANDLERS ===== */
    /* These call HA services - safe because undefined checks prevent errors if hidden */
    if (upBtn) upBtn.addEventListener('click', () => this._callService('open_cover'));
    if (stopBtn) stopBtn.addEventListener('click', () => this._callService('stop_cover'));
    if (downBtn) downBtn.addEventListener('click', () => this._callService('close_cover'));
    if (favoriteBtn) {
      favoriteBtn.addEventListener('click', () => {
        const favPos = parseInt(this._config.favorite, 10) || 50;
        // Send favorite position (0-100) to HA
        this._callService('set_cover_position', { position: favPos });
      });
    }

    /* ===== DRAG START HANDLERS ===== */
    /* Listen for both mouse and touch to begin dragging */
    if (handleEl) {
      handleEl.addEventListener('mousedown', (e) => {
        e.preventDefault();     // Prevent text selection during drag
        this._startDrag();
      });

      /* Touch drag: use passive:true to not block scrolling */
      handleEl.addEventListener('touchstart', (e) => {
        this._startDrag();
      }, { passive: true });
    }

    /* ===== DOCUMENT-LEVEL DRAG TRACKING ===== */
    /* Monitor mouse/touch movement across entire document while dragging */
    document.addEventListener('mousemove', (e) => {
      if (this._isDragging) this._handleDrag(e.clientY, container);
    });

    document.addEventListener('touchmove', (e) => {
      if (this._isDragging && e.touches.length > 0) {
        this._handleDrag(e.touches[0].clientY, container);
      }
    }, { passive: true });

    /* ===== DRAG END HANDLERS ===== */
    /* Finalize drag: hide overlay and send final position to HA */
    const endDragHandler = () => {
      if (this._isDragging) {
        this._isDragging = false;           // Stop accepting drag updates
        const overlay = this.shadowRoot.getElementById('overlay');
        if (overlay) overlay.classList.remove('active');  // Hide motion overlay

        /* Send final position to HA (rounded to nearest percent) */
        this._callService('set_cover_position', { position: Math.round(this._position) });
      }
    };

    document.addEventListener('mouseup', endDragHandler);
    document.addEventListener('touchend', endDragHandler);
  }

  /**
   * Begin drag interaction: sets flag and shows visual feedback
   */
  _startDrag() {
    this._isDragging = true;   // Prevent HA updates from overwriting position
    const overlay = this.shadowRoot.getElementById('overlay');
    if (overlay) overlay.classList.add('active');  // Show motion overlay
  }

  /**
   * During drag: Update position based on mouse/touch Y coordinate
   * Converts pixel position to 0-100% scale and updates visuals in real-time
   */
  _handleDrag(clientY, container) {
    if (!container) return;

    // Get container's position and dimensions on screen
    const containerRect = container.getBoundingClientRect();
    const containerHeight = containerRect.height;
    const currentY = clientY - containerRect.top;  // Y offset within container

    // Calculate closed percentage (0=top, 100=bottom)
    // Clamp to 0-100 range
    const closedPercent = Math.max(0, Math.min(100, (currentY / containerHeight) * 100));

    // Invert: closed % -> open % (0% closed = 100% open)
    this._position = 100 - closedPercent;

    /* ===== REAL-TIME VISUAL FEEDBACK ===== */
    /* Update shutter slats height to reflect current position */
    const contentEl = this.shadowRoot.getElementById('content');
    if (contentEl) contentEl.style.height = closedPercent + '%';

    /* Update position percentage display in center */
    const posDisplay = this.shadowRoot.getElementById('positionDisplay');
    if (posDisplay) posDisplay.innerHTML = `<span>${Math.round(this._position)}%</span>`;
  }

  /**
   * Utility: Call a Home Assistant service on the cover entity
   * Used for open, close, stop, and set_position commands
   */
  _callService(serviceName, serviceData = {}) {
    this._hass.callService('cover', serviceName, {
      entity_id: this._config.entity,  // Target entity from config
      ...serviceData                   // Merge with additional service params
    });
  }

  /**
   * Update DOM: Refresh visual state based on current HA state
   * Handles: title, position height, motion indicators, button states
   */
  _updateDom() {
    const titleEl = this.shadowRoot.getElementById('title');
    const contentEl = this.shadowRoot.getElementById('content');
    const overlayEl = this.shadowRoot.getElementById('overlay');
    const posDisplay = this.shadowRoot.getElementById('positionDisplay');

    const upBtn = this.shadowRoot.getElementById('upBtn');
    const downBtn = this.shadowRoot.getElementById('downBtn');
    const stopBtn = this.shadowRoot.getElementById('stopBtn');
    const favoriteBtn = this.shadowRoot.getElementById('favoriteBtn');

    /* Update title if entity name changed */
    if (titleEl && titleEl.textContent !== this._entityName) {
      titleEl.textContent = this._entityName;
    }

    /* Update shutter visual height only if NOT actively dragging */
    if (contentEl && !this._isDragging) {
      const closedPercent = 100 - this._position;
      contentEl.style.height = closedPercent + '%';
    }

    /* ===== MOTION INDICATORS ===== */
    /* Show motion overlay with arrow icon when shutter is opening/closing */
    if (overlayEl && posDisplay && !this._isDragging) {
      if (this._haState === 'opening') {
        overlayEl.classList.add('active');
        posDisplay.innerHTML = '<ha-icon icon="mdi:arrow-up"></ha-icon>';
      } else if (this._haState === 'closing') {
        overlayEl.classList.add('active');
        posDisplay.innerHTML = '<ha-icon icon="mdi:arrow-down"></ha-icon>';
      } else {
        overlayEl.classList.remove('active');  /* Hide overlay when idle */
      }
    }

    /* ===== BUTTON STATE MANAGEMENT ===== */
    /* Convert positions to integers for comparison */
    const currentPos = Math.round(Number(this._position));
    const favoritePos = Math.round(Number(this._config.favorite));

    /* Disable favorite button if already at favorite position */
    if (favoriteBtn) {
      favoriteBtn.disabled = (currentPos === favoritePos);
    }

    /* Up button: disable when fully open (100%), highlight when opening */
    if (upBtn) {
      upBtn.disabled = (currentPos >= 100);
      upBtn.classList.toggle('active', this._haState === 'opening');
    }

    /* Down button: disable when fully closed (0%), highlight when closing */
    if (downBtn) {
      downBtn.disabled = (currentPos <= 0);
      downBtn.classList.toggle('active', this._haState === 'closing');
    }

    /* Stop button: always enabled, never highlighted (neutral) */
    if (stopBtn) {
      stopBtn.classList.remove('active');
    }
  }

  /**
   * Error display: Shows error message if entity not found or config invalid
   */
  _renderError(errorMsg) {
    this.shadowRoot.innerHTML = `
      <ha-card class="error-card">
        <strong>Lovelace Error:</strong> ${errorMsg}
      </ha-card>
    `;
  }

  /**
   * Card size hint for Lovelace grid layout
   * Value: 1 = small block, 2 = medium, etc.
   */
  getCardSize() {
    return 2;  /* Card occupies ~2 small blocks of vertical space */
  }
}

/**
 * Register the main ShutterNew card with the browser
 * Makes <shutter-new> usable as a custom element
 */
customElements.define('shutter-new', ShutterNew);

/* ===========================================================================
   EDITOR CLASS: ShutterNewEditor

   Handles card configuration interface in Lovelace
   - Uses Home Assistant's native <ha-form> with schema-driven approach
   - No custom CSS or input hacks
   - Integrates with HA's translation system
   =========================================================================== */
class ShutterNewEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    // Translations storage and loading state
    this._translations = {};
    this._translationsLoaded = false;
    // Load translations immediately from browser language
    this._initTranslations();
  }

  /**
   * Initialize translations from browser language or HA language later
   */
  _initTranslations() {
    // Try to get language from browser
    const browserLang = navigator.language || navigator.userLanguage || 'en';
    loadTranslations(browserLang).then(translations => {
      this._translations = translations;
      this._translationsLoaded = true;
      // If config already set, re-render with new translations
      if (this._config) {
        this._render();
      }
    }).catch(err => {
      console.error('[ShutterNewEditor._initTranslations] Error loading translations:', err);
    });
  }

  /**
   * HA updates: Pass hass context to the form element for service calls
   * and localization
   */
  set hass(hass) {
    // If translations still not loaded, load with HA language
    if (!this._translations || !this._translations['open']) {
      const haLang = hass.language || 'en';
      loadTranslations(haLang).then(translations => {
        this._translations = translations;
        this._translationsLoaded = true;
        // Update form labels after translations load
        if (this._form) {
          this._form.computeLabel = this._computeLabel.bind(this);
          this._form.hass = hass;
        }
      });
      this._hass = hass;
      return;
    }
    
    this._hass = hass;
    /* Propagate hass to form if already created */
    if (this._form) {
      this._form.hass = hass;
    }
  }

  /**
   * Lovelace callback: receives current card config
   * Triggers render to display form with current values
   */
  setConfig(config) {
    this._config = config;
    this._render();
  }

  /**
   * Render: Generate form UI based on HA's native schema system
   * Handles all form interactions and validation
   */
  _render() {
    if (!this._config) return;

    /* Get translated labels for form fields (from local translation files) */
    const labelOpen = this._localize('open', 'Open');
    const labelStop = this._localize('stop', 'Stop');
    const labelClose = this._localize('close', 'Close');
    const labelFavorite = this._localize('favorite', 'Favorite');
    const labelPosition = this._localize('position', 'Position');
    const labelLeft = this._localize('left', 'Left');
    const labelRight = this._localize('right', 'Right');

    /* ===== CONFIGURATION SCHEMA ===== */
    /* Native HA schema defines form fields and their types */
    const SCHEMA = [
      /* Entity selector: user picks a cover entity */
      {
        name: "entity",
        required: true,           // Must be set
        selector: {
          entity: {
            domain: "cover"       // Only show cover entities
          }
        }
      },

      /* Custom entity name (optional) */
      {
        name: "name",
        selector: {
          text: {}                // Simple text input
        }
      },

      /* Favorite position slider (0-100%) */
      {
        name: "favorite",
        selector: {
          number: {
            min: 0,
            max: 100,
            step: 1,
            mode: "box"            // Number input box
          }
        }
      },

      /* Position of control buttons (left or right) */
      {
        name: "position",
        selector: {
          select: {
            options: [
              { value: "left", label: labelLeft },
              { value: "right", label: labelRight }
            ]
          }
        }
      },

      /* Expandable section: hide specific controls */
      {
        name: "hide",
        type: "expandable",
        title: this._localize('hide', 'Hide'),
        expanded: true,            // Expanded by default

        schema: [
          /* Multi-select: choose which buttons to hide */
          {
            name: "items",
            /* Multi-select list of buttons to hide */
            selector: {
              select: {
                multiple: true,    // User can select multiple
                mode: "list",      // Show as checkbox list

                options: [
                  { value: "up", label: labelOpen },
                  { value: "down", label: labelClose },
                  { value: "stop", label: labelStop },
                  { value: "favorite", label: labelFavorite }
                ]
              }
            }
          }
        ]
      }
    ];

    /* ===== FORM DATA ===== */
    /* Convert config to form-friendly structure */
    const formData = {
      entity: this._config.entity || "",
      name: this._config.name || "",
      favorite:
        this._config.favorite !== undefined
          ? this._config.favorite
          : 50,                        // Default to 50% if not set
      position: this._config.position || "left",  // Default to "left" if not set
      hide: {
        items: this._config.hide || [] // Array of hidden controls
      }
    };

    /* Create minimal form container */
    this.shadowRoot.innerHTML = `
      <ha-form id="form"></ha-form>
    `;

    /* Get reference to form element */
    this._form = this.shadowRoot.getElementById('form');

    /* Configure form with schema, data, and handlers */
    this._form.hass = this._hass;                                  // HA context for translations
    this._form.data = formData;                                    // Current values
    this._form.schema = SCHEMA;                                    // Field definitions
    this._form.computeLabel = this._computeLabel.bind(this);       // Custom labels

    /* Listen for form changes */
    this._form.addEventListener(
      'value-changed',
      (ev) => this._valueChanged(ev)  // User changed a field
    );
  }

  /**
   * Utility: Get translated text from local translation files
   * Falls back to English version if translation key not found
   * Format: key should be like 'open', 'close', 'stop', etc.
   */
  _localize(key, fallback = '') {
    // Return from local translations if available
    if (this._translations && this._translations[key]) {
      return this._translations[key];
    }
    // Fallback to English string if translation not found
    return fallback || key;
  }

  /**
   * Custom field labels for the form
   * Maps schema field names to user-friendly labels
   */
  _computeLabel(schema) {
    /* Get translated labels from local translation files */
    const entityLabel = this._localize('entity', 'Entity');
    const nameLabel = this._localize('name', 'Name');
    const favLabel = this._localize('favorite_position', 'Favorite position (0-100)');
    const hideLabel = this._localize('hide', 'Hide');
    const posLabel = this._localize('position', 'Position');

    /* Define human-friendly labels for each field */
    const labels = {
      entity: entityLabel,

      name: `${nameLabel} (Optional)`,

      favorite: `${favLabel}`,

      position: posLabel,

      hide: hideLabel,

      items: ""  // Hide "items" label (looks better)
    };

    return labels[schema.name] || "";  // Return label or empty string
  }

  /**
   * Form change handler: Send updated config back to Lovelace
   * Lovelace listens for "config-changed" event to persist changes
   */
  _valueChanged(ev) {
    const formData = ev.detail.value;

    /* Build config object to send back to Lovelace */
    const config = {
      type: this._config.type || "custom:shutter-new",  // Card type identifier

      entity: formData.entity,

      favorite: formData.favorite,

      position: formData.position || "left",           // Button position (left or right)

      hide: formData.hide?.items || []                  // Array of hidden controls
    };

    /* Only include name in config if user entered one (cleaner YAML) */
    if (formData.name && formData.name !== '') {
      config.name = formData.name;
    }

    /* Dispatch custom event so Lovelace knows to save new config */
    const event = new CustomEvent(
      "config-changed",
      {
        detail: { config },
        bubbles: true,          // Propagate up DOM tree
        composed: true          // Cross shadow DOM boundary
      }
    );

    this.dispatchEvent(event);
  }
}

/**
 * Register the editor custom element
 */
customElements.define('shutter-new-editor', ShutterNewEditor);

/**
 * Register card with Lovelace for discovery and display in card picker
 * Provides metadata: type, display name, preview mode, and description
 */
window.customCards = window.customCards || [];                                 // Initialize array if missing
window.customCards.push({
  type: "shutter-new",                                                         // Identifier matching card definition
  name: "Roller Shutter Controller",                                           // Display name in card picker
  preview: true,                                                               // Show preview in editor
  description: "An ultra-compact 100x100px roller shutter with touch control"  // Help text
});
