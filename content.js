"use strict";

function injectCustomCSS() {
    return new Promise((resolve, reject) => {
        // Check if the CSS is already injected
        const existingLink = document.querySelector('link[href*="page-styles.css"]');
        if (existingLink) {
            console.log('CSS already injected');
            resolve();
            return;
        }

        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.type = 'text/css';
        link.href = chrome.runtime.getURL('page-styles.css');
      
        link.onload = () => {
            console.log('Custom CSS loaded successfully');
            resolve();
        };
      
        link.onerror = (error) => {
            console.error('Error loading custom CSS:', error);
            reject(error);
        };
  
        (document.head || document.documentElement).appendChild(link);
    });
}
  
// Inject CSS when the content script runs
injectCustomCSS()
    .then(() => {
        console.log('CSS injection completed');
    })
    .catch((error) => {
        console.error('CSS injection failed:', error);
    });


// Not implemented: Listen for messages from the background script if you want to toggle CSS
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "toggleCSS") {
        const existingLink = document.querySelector('link[href*="custom-styles.css"]');
        if (existingLink) {
        existingLink.disabled = !existingLink.disabled;
        console.log('CSS toggled:', existingLink.disabled ? 'off' : 'on');
        } else {
        injectCustomCSS();
        }
    }
});


// Wire up MutationObservers
function onProductGridAdded(callback) {
    const targetNode = document.body;
    const config = { childList: true, subtree: true };
    
    const observer = new MutationObserver((mutationsList, observer) => {
        const productGrid = document.querySelector('product-grid');
        if (productGrid) {
            observer.disconnect();
            callback(productGrid);
            observeProductGridChanges(productGrid);
        }
    });

    observer.observe(targetNode, config);
}

const DEFAULT_BACKGROUND_COLOR = 'rgb(255,255,255)';

function resetExtensionState(productGrid) {
    // hide types of product advertisements.
    productGrid.querySelectorAll('cdx-card.card').forEach(element => {
        if (element.style.backgroundColor != DEFAULT_BACKGROUND_COLOR) {
            console.log('Resetting bg color.');
            element.style.backgroundColor = DEFAULT_BACKGROUND_COLOR;
        }
    });
}

function observeProductGridChanges(productGrid) {
    let timeout = null;
    const config = { childList: true, subtree: true };

    const observer = new MutationObserver((mutationsList, observer) => {
        // Clear any existing timeout
        if (timeout) {
            clearTimeout(timeout);
        }

        // Set a new timeout
        timeout = setTimeout(() => {
            console.log('product-grid children have changed');
            // Perform desired actions here
        }, 100); // 100ms debounce 
    });

    observer.observe(productGrid, config);
}

onProductGridAdded(() => {
    console.log('product-grid has been added to the DOM');
    // Perform desired actions here
});

function generateUniqueId() {
    return 'id-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
}

const getBackgroundColor = (pricingType) => {
    const colors = {
        [PricingTypes.BY_WEIGHT]:     'beige',
        [PricingTypes.BY_VOLUME]:     'lightblue',
        [PricingTypes.BY_EACH]:       'pink'
    };
    const color = colors[pricingType] || '';
    return color;
};


function getTextContentOrDefault(rootElement, elementSelector, defaultValue = '') {
    // Find the named element within the rootElement
    const textElement = rootElement.querySelector(elementSelector);
    // If the element doesn't exist then just return defaultValue
    if (!textElement) {
        return defaultValue;
    }
    // Pull the textContent from the DOM element and return it
    const text = textElement.textContent;
    return (text || '') === '' ? defaultValue : text.trim();
}

class ProductPriceAndWeightInfo {

    // Private class variables
    #domProductTitleString;
    #domWeightString;
    #domUnitPriceString;
    #domPriceDollarsString;
    #domPriceCentsString;
    #weight;
    #units;
    #quantityInPack;
    #pricingType;

    constructor (domElement) {
        // Grab values we're going to need from the element
        this.#domProductTitleString = replaceNbsp( getTextContentOrDefault(domElement, '.product-entry > h3'));
        this.#domWeightString = replaceNbsp(getTextContentOrDefault(domElement, 'span.size'));
        this.#domUnitPriceString = getTextContentOrDefault(domElement, 'product-price-meta span.cupPrice');
        this.#domPriceDollarsString = getTextContentOrDefault(domElement, 'h3 > em');
        this.#domPriceCentsString = getTextContentOrDefault(domElement, 'h3 > span');

        // Extract all the components of the prices
        this.#extractWeightComponents();

        // If weight and units weren't found then try parsing from alternate sources
        if (this.#units == '' || this.#weight == 0) {
            this.#parseUnitPriceFromUnitPriceString();
        }

        // Calculate the normalized price per unit of volume/mass
        this.#normalizeWeightAndPrice();
    }

    // Combines dollars and cents and returns a floating point number representing
    // the item price.
    get #advertisedPrice() {
        const dollars = parseInt(this.#domPriceDollarsString) || 0;
        const cents = parseInt(this.#domPriceCentsString) || 0;
        return (dollars * 100 + cents) / 100;
    }

    // A free-text formatted unit price string for embedding in the dom and for debugging
    get friendlyPriceString() {
        if (this.#pricingType === PricingTypes.BY_EACH && this.#quantityInPack === 1) {
            return `$${this.pricePerPack.toFixed(2)} ea`;
        } 
        else if (this.#pricingType === PricingTypes.BY_EACH && this.#quantityInPack > 1) {
            const individualItemPrice = (this.pricePerPack / this.#quantityInPack).toFixed(2);
            return `$${this.pricePerPack.toFixed(2)} for ${this.#quantityInPack} ($${individualItemPrice} for 1)`;
        }
        else {
            return `$${this.pricePerPack.toFixed(2)} per ${this.#units}`;
        }
    }

    get pricePerPack() {
        return this.#advertisedPrice / this.#weight;
    }

    get packQuantity() {
        // If the qty hasn't been found it will still be set to 0, so set it to 1.
        return this.#quantityInPack == 0 ? 1 : this.#quantityInPack;
    }

    get pricingType() {
        return this.#pricingType;
    }

    // Take the unit price string found in the DOM and extract price, weight, and units from it.
    // Generally a fallback method as this is calculated by the vendor and if we don't necessarily want
    // to assume it's correct.
    // Overwrite price, weight, units, pricingType
    #parseUnitPriceFromUnitPriceString() {
        // DOM string is formatted something like '$0.48 / 100g', '$3.99 / 1ea'
        const regex = /^\$([\d.]{1,5})(?: \/ )(\d{1,3})(mL|L|g|kg|ea)$/gi;
        const result = regex.exec(this.#domUnitPriceString);

        if (result) {
            const price = parseFloat(result[1]).toFixed(2);
            const weight = parseInt(result[2]);
            const units = result[3];
            let pricingType;

            // Set the pricing type based on the values expected
            if (units === 'kg' || units === 'g') {
                pricingType = PricingTypes.BY_WEIGHT;
            }
            else if (units === 'L' || units === 'ml') {
                pricingType = PricingTypes.BY_VOLUME;
            }
            else if (units == 'ea') {
                pricingType = PricingTypes.BY_EACH;
            }

            // Store retrieved values
            this.#units = units;
            this.#weight = weight;
            this.#pricingType = pricingType;

            // Set the unit price as the advertised price 
            const val = splitCurrency(price);
            this.#domPriceDollarsString = val.dollars;
            this.#domPriceCentsString = val.cents;
        }
    }

    // Receives a string of formatted text from the ui and returns a numeric weight suitable for
    // factoring into calculations to determine the unit price of an item.
    #extractWeightComponents() {
        const weightString = this.#domWeightString;
        const productTitleString = this.#domProductTitleString;

        let weight = 0;
        let qty = 0;
        let units = '';
        let pricingType = '';

        const patterns = [
            {
                // Strings in the format '100g pottles 1200g'
                regex: /^(\d{1,5})g.*?(\d{1,5})g$/gi,
                process: (result) => {
                    qty = parseQtyFromPriceString(productTitleString);
                    weight = parseInt(result[2]);
                    units = 'g';
                    pricingType = PricingTypes.BY_WEIGHT;
                }
            },
            {
                // Strings in the format '100g pottles 12pack' and '70g pouches 5pack'
                regex: /^(\d{1,3})g(?:.+?)(\d{1,3})pack$/gi,
                process: (result) => {
                    qty = 1;
                    weight = parseInt(result[1]) * parseInt(result[2]);
                    units = 'g';
                    pricingType = PricingTypes.BY_WEIGHT;
                }
            },
            {
                // Strings in the format '4 x 220g' and 'Cans 4 x 220g'
                regex: /^.*?(\d{1,3}) x (\d{1,3})(mL|L|g|kg)$/i,
                process: (result) => {
                    qty = parseInt(result[1]);
                    weight = qty * parseInt(result[2]);
                    units = result[3];
                    pricingType = (units === 'kg' || units === 'g') ? PricingTypes.BY_WEIGHT : PricingTypes.BY_VOLUME;
                }
            },
            {
                // Strings in the format 'Bottle 1L', '750g', '1.2kg', 'Tub Sugar 1kg'
                regex: /^(?:.)*?([\d.]{1,5})(mL|L|g|kg)$/gi,
                process: (result) => {
                    qty = 1;
                    weight = parseFloat(result[1]);
                    units = result[2];
                    pricingType = (units === 'kg' || units === 'g') ? PricingTypes.BY_WEIGHT : PricingTypes.BY_VOLUME;
                }
            },
            {
                // Strings in the format '100g pottles'
                regex: /^(\d{1,5})g.*?$/gi,
                process: (result) => {
                    qty = parseQtyFromPriceString(productTitleString);
                    weight = qty * parseInt(result[1]);
                    units = 'g';
                    pricingType = PricingTypes.BY_WEIGHT;
                }
            },
            {
                // Strings in the format 'Cans 3pack', '3pack' - no weight
                regex: /(\d{1,3})pack$/i,
                process: (result) => {
                    qty = parseInt(result[1]);
                    weight = 0;
                    units = 'g';
                    pricingType = PricingTypes.BY_WEIGHT;
                }
            }
        ];

        for (let { regex, process } of patterns) {
            const result = regex.exec(weightString);
            if (result) {
                process(result);
                break;
            }
        }

        this.#weight = weight;
        this.#units = units;
        this.#quantityInPack = qty;
        this.#pricingType = pricingType;
    }

    // This method takes the weight and units of the product and converts to common units so they can be compared
    #normalizeWeightAndPrice() {
        // If weight is currently mL then convert to L
        if (this.#units == 'mL') {
            this.#units = 'L';
            this.#weight = this.#weight / 1000;
        }
        // If weight is currently g then convert to kg
        else if (this.#units == 'g') {
            this.#units = 'kg';
            this.#weight = this.#weight / 1000;
        }
    }
}

// Event handler to detect and react to the click event from popup.html
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.type) {
        case "xhr_detected":
            console.log("XHR detected with URL:", request.url);
            // Reset the background colors of product cards, DOM about to change
            elems = document.querySelectorAll('cdx-card.card');
            elems.forEach(element => {
                element.style.backgroundColor = DEFAULT_BACKGROUND_COLOR;
            });
            break;

        case "change_color":
            // remove the banner container
            const el = document.querySelector('.banner-container');            
            if (el) {
                el.remove();
            }
            // hide types of product advertisements.
            ['cdx-cta', 'product-content-in-grid'].forEach(x => {
                document.querySelectorAll(x).forEach(element => {
                    element.remove();
                });
            });
            // highlight all product cards
            document.querySelectorAll('cdx-card.card').forEach(element => {

                const product = new ProductPriceAndWeightInfo(element)

                // Find the image element and add a title attribute showing the unit price string
                let img = element.querySelector('img');
                img.setAttribute('title', product.friendlyPriceString);

                // Add the unit price to the card element as a new data value
                element.setAttribute('data-sort-value-a', product.pricingType);
                element.setAttribute('data-sort-value-b', product.pricePerPack);

                // Set the background color of the product card
                element.style.backgroundColor = product.pricePerPack === Infinity 
                    ? 'red' 
                    : getBackgroundColor(product.pricingType);

                // Capture the output while we're debugging.
                console.log(`Weight string: ${product.weightString} => Quantity: ${product.packQuantity}, Weight: ${product.weight}, ` +
                    `Units: ${product.units}, Price: ${product.advertisedPrice}, ` +
                    `Calc. Unit Price: ${product.friendlyPriceString}`);
            });

            // find the product-grid and sort child elements based on new value.
            const grid = document.getElementsByTagName('product-grid')[0];
            if (grid) {
                // grab the child elements of the grid and convert to array.
                const products = grid.querySelectorAll('cdx-card.card');

                // create array for sorting.
                const aProducts = Array.from(products);

                // sort.
                aProducts.sort((first,second) => {
                    const firstA = parseFloat(first.getAttribute('data-sort-value-a'));
                    const secondA = parseFloat(second.getAttribute('data-sort-value-a'));
                    const firstB = parseFloat(first.getAttribute('data-sort-value-b'));
                    const secondB = parseFloat(second.getAttribute('data-sort-value-b'));
                    if (firstA < secondA) return -1;
                    if (firstA > secondA) return 1;
                    if (firstB < secondB) return -1;
                    if (firstB > secondB) return 1;
                    return 0;
                });

                // Remove original elements
                products.forEach(e => {
                    grid.removeChild(e);
                });

                // (Re)append each element in the array to the grid
                aProducts.forEach(product => {
                    grid.appendChild(product);
                });
            }
        break;

        default:
            // Unrecognised message
            console.log(`Unrecognised message: ${request.type}`);
    }
});



function replaceNbsp(str) {
    return str.replace(/\u00A0/g, ' ');
}

function parseQtyFromPriceString (productTitle) {
    // Look for a numeric value preceeded by 'pk' or 'pack'
    let regex = RegExp('^.*?(\\d{1,3})(?:pk|pack).*?$', 'gi');
    let result = regex.exec(productTitle);
    if (result) {
        qty = parseInt(result[1]);
        return qty;
    }
    
    return 0;
}

const PricingTypes = Object.freeze({
    BY_WEIGHT:  1,
    BY_VOLUME:  2,
    BY_EACH:    3
})


function splitCurrency(amount) {
    // Use the absolute value to avoid negative zero issues with cents
    let absoluteAmount = Math.abs(amount);

    // Split the absolute value into integer and decimal parts
    let dollars = Math.floor(absoluteAmount);
    let cents = Math.round((absoluteAmount - dollars) * 100);

    // If the original amount was negative, apply the sign to the dollars amount
    if (amount < 0) {
        dollars = -dollars;
    }

    return {
        dollars: dollars,
        cents: cents
    };
}