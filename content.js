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
        }
        else {
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

    // Stores the raw string values retrieved from the DOM for a product
    #domWeightString;
    #domUnitPriceString;
    #domProductTitleString;
    #domPriceCentsWeightString;
    #domPriceDollarsString;
    #domPriceCentsString;
    #domSingleUnitPriceString;

    // Stores the 'per package' values related to a product
    #packageQuantity;
    #packageQuantityUnits;
    #numItemsInPackage;
    #packagePricingType;
    #hasWeightInWeightString;

    // Stores the 'per unit quantity' values related to a product
    #perUnitQuantity;
    #perUnitQuantityUnits;
    #perUnitNumItems;
    #perUnitQuantityPricingType;
    #perUnitQuantityPrice;
    #principleUnitPrice;

    constructor (domElement) {
        // Read the values we need from DOM strings
        this.#domWeightString = replaceNbsp(getTextContentOrDefault(domElement, 'span.size'));
        this.#domUnitPriceString = getTextContentOrDefault(domElement, 'product-price-meta span.cupPrice');
        this.#domSingleUnitPriceString = replaceNbsp(getTextContentOrDefault(domElement, 'p.price-single-unit-text'));
        this.#domProductTitleString = replaceNbsp(getTextContentOrDefault(domElement, '.product-entry > h3'));
        this.#domPriceDollarsString = replaceNbsp(getTextContentOrDefault(domElement, 'h3.presentPrice > em'));
        this.#domPriceCentsWeightString = replaceNbsp(getTextContentOrDefault(domElement, 'h3.presentPrice > span'));

//        this.#hasKgInCents = this.#domPriceCentsWeightString?.includes('kg') ? true : false;
        this.#domPriceCentsString = parseInt(this.#domPriceCentsWeightString);

        // Store values related to the main price and quantity values
        const values = this.#extractPerPackageQuantityValues();
        if (values) {
            this.#packageQuantity = values.quantity;
            this.#packageQuantityUnits = values.quantityUnits;
            this.#numItemsInPackage = values.numItems;
            this.#packagePricingType = values.pricingType;
            this.#hasWeightInWeightString = values.hasWeight;
        }

        // Store values related to the per-unit pricing that is included for *some* products
        const unitValues = this.#extractPerUnitQuantityValues();
        if (unitValues) {
                this.#perUnitQuantity = unitValues.quantity;
                this.#perUnitQuantityUnits = unitValues.quantityUnits;
                this.#perUnitNumItems = unitValues.numItems;
                this.#perUnitQuantityPricingType = unitValues.pricingType;
                this.#perUnitQuantityPrice = unitValues.price;
        }

        // Calculate the principle unit price based on the domUnitPriceString
        // Because values have been normalized the principle unit price is just the per-unit price
        if (this.#perUnitQuantity || 0 !== 0) {
            this.#principleUnitPrice = this.#perUnitQuantityPrice;
        }

        // If the product variation is PRODUCT_8 then set class variables explicity 
        // before calling normalize
        if (this.productVariation == ProductVariations.PRODUCT_8) {
            this.#packageQuantity = 1;              // 1kg
            this.#packageQuantityUnits = "kg";      // 1kg
        }

        this.#normalizePerPackageQuantityValues();
        this.#normalizePerUnitQuantityValues();

        if (this.#authPricingType === undefined || this.#authPricingType === null) {
            console.error('Indeterminite pricing type: ', [this.#domProductTitleString, this.#domUnitPriceString, this.#domWeightString]);
        }

        if (this.productVariation === undefined || this.productVariation === null) {
            console.error('Indeterminite product variation: ', this.#domProductTitleString);
        }
    }


    get pricingType() {
        return this.#authPricingType;
    }


    get advertisedPrice() {
        const dollars = parseInt(this.#domPriceDollarsString) || 0;
        const cents = parseInt(this.#domPriceCentsString) || 0;
        return (dollars * 100 + cents) / 100;
    }


    // Return the principle unit price if it exists. This ensures the unit price published by the
    // vendor has priority if it exists.
    get sortableUnitPrice() {
        let sortablePrice;

        switch (this.productVariation) {
            case ProductVariations.PRODUCT_4:
                sortablePrice = this.advertisedPrice;
                break;

            case ProductVariations.PRODUCT_5:
                sortablePrice = this.advertisedPrice;
                break;

            case ProductVariations.PRODUCT_6:
                sortablePrice = this.unitPricePerItem;
                break;

            case ProductVariations.PRODUCT_7:
                sortablePrice = this.unitPricePerItem;
                break;

            case ProductVariations.PRODUCT_8:
                sortablePrice = this.unitPricePerItem;
                break;

            default:
                if (this.#authPricingType === PricingTypes.BY_EACH) {
                    if (this.unitPricePerItem && (this.unitPricePerItem || 0) > 0) {
                        sortablePrice = this.unitPricePerItem;
                    }
                    else {
                        sortablePrice = this.advertisedPrice;
                    }
                }
                else {
                    sortablePrice = this.unitPricePerItem;
                }
        }

        return sortablePrice.toFixed(2);
    }


    // A free-text formatted unit price string
    get friendlyPriceString() {
        if (this.#authPricingType === PricingTypes.BY_EACH) {
            return `$${this.sortableUnitPrice} ${this.units}`;
        }
        else {
            return `$${this.sortableUnitPrice} per ${this.units}`;
        }
    }


    // Get the calculated price of this item
    get unitPricePerItem() {
        let price;

        if (this.productVariation == ProductVariations.PRODUCT_7) {
            price = this.advertisedPrice / (this.#packageQuantity / 100);
        }
        else if (this.#hasWeightInWeightString && this.pricingType === PricingTypes.BY_EACH && this.#perUnitQuantity === 1) {
            price = this.advertisedPrice / (this.#packageQuantity / 100);
        }
        else if (this.pricingType === PricingTypes.BY_EACH && this.#perUnitQuantity === 1) {
            price = this.#principleUnitPrice;
        }
        else if (this.#perUnitQuantityPrice !== "" && this.#perUnitQuantity > 0) {
            price = this.#perUnitQuantityPrice / (this.#perUnitQuantity / 100);
        }
        else {
            price = this.advertisedPrice / (this.#packageQuantity / 100);
        }

        if (price !== Infinity && price !== 0 && !Number.isNaN(price)) {
            return parseFloat(price);
        }
        else {
            return null;
        }
    }

    get pricingType() {
        return this.#authPricingType;
    }


    get units() {
        if (this.#authPricingType === PricingTypes.BY_WEIGHT) {
            return '100g';
        }
        else if (this.#authPricingType === PricingTypes.BY_VOLUME) {
            return '100mL';
        }
        else {
            return this.#packageQuantityUnits;
        }
    }


    get #hasKgInCents() {
        return this.#domPriceCentsWeightString?.includes('kg') ? true : false;
    }


    get productVariation() {
        let productVariation;

        if (this.#hasKgInCents && this.#domSingleUnitPriceString !== "") {
            productVariation = ProductVariations.PRODUCT_8;
        }
        else if (this.#domUnitPriceString === '') {
            if (this.#hasWeightInWeightString) {
                productVariation = ProductVariations.PRODUCT_1;
            }
            else {
                if (this.#hasKgInCents) {
                    // NOT IMPLEMENTED
                }
                else {
                    productVariation = ProductVariations.PRODUCT_4;
                }
            }
        }
        else {
            if (this.#hasWeightInWeightString) {
                if (this.#authPricingType === PricingTypes.BY_WEIGHT) {
                    productVariation = ProductVariations.PRODUCT_7;
                }
                else {
                    productVariation = ProductVariations.PRODUCT_3;
                }
            }
            else {
                if (this.#hasKgInCents) {
                    productVariation = ProductVariations.PRODUCT_2;
                }
                else {
                    if (this.#numItemsInPackage > 1) {
                        productVariation = ProductVariations.PRODUCT_6;
                    }
                    else {
                        productVariation = ProductVariations.PRODUCT_5;
                    }
                }
            }
        }

        return productVariation;
    }


    get #authPricingType() {
        let pricingType;

        // Figure out the PricingType based on the data we've gathered
        if (this.#hasKgInCents && this.#domSingleUnitPriceString !== "") {
            pricingType = PricingTypes.BY_WEIGHT;
        }
        else if (this.#packagePricingType === PricingTypes.BY_EACH || this.#perUnitQuantityPricingType === PricingTypes.BY_EACH) {
            if (this.#hasWeightInWeightString) {
                pricingType = PricingTypes.BY_WEIGHT;
            }
            else {
                pricingType = PricingTypes.BY_EACH;
            }
        }
        else if (this.#packagePricingType === PricingTypes.BY_VOLUME || this.#perUnitQuantityPricingType === PricingTypes.BY_VOLUME) {
            pricingType = PricingTypes.BY_VOLUME;
        }
        else if (this.#packagePricingType === PricingTypes.BY_WEIGHT || this.#perUnitQuantityPricingType === PricingTypes.BY_WEIGHT) {
            pricingType = PricingTypes.BY_WEIGHT;
        }

        return pricingType;
    }


    #normalizePerPackageQuantityValues() {
        if (this.#packageQuantityUnits && this.#packageQuantity) {
            if (this.#packageQuantityUnits === 'kg' || this.#packageQuantityUnits === 'L') {
                this.#packageQuantity *= 1000;
                this.#packageQuantityUnits = (this.#packageQuantityUnits === 'kg') ? 'g' : 'mL';
            }
        }
    }


    #normalizePerUnitQuantityValues() {
        if (this.#perUnitQuantityUnits && this.#perUnitQuantity) {
            if (this.#perUnitQuantityUnits === 'kg' || this.#perUnitQuantityUnits === 'L') {
                this.#perUnitQuantity *= 1000;
                this.#perUnitQuantityUnits = (this.#perUnitQuantityUnits === 'kg') ? 'g' : 'mL';
            }
        }
    }


    // Take the unit price string found in the DOM and extract price, weight, and units from it.
    // Generally a fallback method as this is calculated by the vendor and if we don't necessarily want
    // to assume it's correct.
    // Overwrite price, weight, units, pricingType
    #extractPerUnitQuantityValues() {
        // DOM string is formatted something like '$0.48 / 100g', '$3.99 / 1ea'
        const regex = /^\$([\d.]{1,5})(?: \/ )(\d{1,3})(mL|L|g|kg|ea)$/gi;
        const result = regex.exec(this.#domUnitPriceString);

        if (result) {
            const perUnitQuantityPrice = parseFloat(result[1]).toFixed(2);
            const perUnitQuantity = parseInt(result[2]);
            const perUnitQuantityUnits = result[3];
            let perUnitQuantityPricingType;

            // Set the pricing type based on the values expected
            if (perUnitQuantityUnits === 'kg' || perUnitQuantityUnits === 'g') {
                perUnitQuantityPricingType = PricingTypes.BY_WEIGHT;
            }
            else if (perUnitQuantityUnits === 'L' || perUnitQuantityUnits === 'mL') {
                perUnitQuantityPricingType = PricingTypes.BY_VOLUME;
            }
            else if (perUnitQuantityUnits === 'ea') {
                perUnitQuantityPricingType = PricingTypes.BY_EACH;
            }

            const values = {
                quantity:       perUnitQuantity,
                quantityUnits:  perUnitQuantityUnits,
                numItems:       1,
                pricingType:    perUnitQuantityPricingType,
                price:          perUnitQuantityPrice
            };
            return values;
        }

        return null;
    }

    // Receives a string of formatted text from the ui and returns a numeric weight suitable for
    // factoring into calculations to determine the unit price of an item.
        #extractPerPackageQuantityValues() {
        let packageQuantity = 1;            // There is at least 1 of a thing in a package
        let quantityMultipler = 1;
        let packageQuantityUnits = '';
        let packagePricingType = '';
        let weightInWeightString = false;

        const patterns = [
            {
                // Strings in the format '100g pottles 1200g'
                regex: /^(\d{1,5})g.*?(\d{1,5})g$/gi,
                process: (result) => {
                    quantityMultipler = 1;
                    packageQuantity = parseInt(result[2]);
                    packageQuantityUnits = 'g';
                    packagePricingType = PricingTypes.BY_WEIGHT;
                    weightInWeightString = true;
                }
            },
            {
                // Strings in the format '100g pottles 12pack' and '70g pouches 5pack'
                regex: /^(\d{1,3})g(?:.+?)(\d{1,3})pack$/gi,
                process: (result) => {
                    quantityMultipler = 1;
                    packageQuantity = parseInt(result[1]) * parseInt(result[2]);
                    packageQuantityUnits = 'g';
                    packagePricingType = PricingTypes.BY_WEIGHT;
                    weightInWeightString = true;
                }
            },
            {
                // Strings in the format '4 x 220g' and 'Cans 4 x 220g'
                regex: /^.*?(\d{1,3}) x (\d{1,3})(mL|L|g|kg)$/i,
                process: (result) => {
                    quantityMultipler = parseInt(result[1]);
                    packageQuantity = quantityMultipler * parseInt(result[2]);
                    packageQuantityUnits = result[3];
                    packagePricingType = (packageQuantityUnits === 'kg' || packageQuantityUnits === 'g') ? PricingTypes.BY_WEIGHT : PricingTypes.BY_VOLUME;
                    weightInWeightString = true;
                }
            },
            {
                // Strings in the format 'Bottle 1L', '750g', '1.2kg', 'Tub Sugar 1kg'
                regex: /^(?:.)*?([\d.]{1,5})(mL|L|g|kg)$/gi,
                process: (result) => {
                    quantityMultipler = 1;
                    packageQuantity = parseFloat(result[1]);
                    packageQuantityUnits = result[2];
                    packagePricingType = (packageQuantityUnits === 'kg' || packageQuantityUnits === 'g') ? PricingTypes.BY_WEIGHT : PricingTypes.BY_VOLUME;
                    weightInWeightString = true;
                }
            },
            {
                // Strings in the format '100g pottles'
                regex: /^(\d{1,5})g.*?$/gi,
                process: (result) => {
                    quantityMultipler = 1;
                    packageQuantity = quantityMultipler * parseInt(result[1]);
                    packageQuantityUnits = 'g';
                    packagePricingType = PricingTypes.BY_WEIGHT;
                    weightInWeightString = true;
                }
            },
            {
                // Strings in the format 'Cans 3pack', '3pack' - no weight so grab from title string
                regex: /(\d{1,3})pack$/i,
                process: (result) => {
                    quantityMultipler = parseInt(result[1]);

                    // Find other values from the product title;
                    const values = this.#parseQuantityAndUnitsFromPriceString();
                    if (values) {
                        packageQuantity = values.quantity;
                        packageQuantityUnits = values.quantityUnits;
                        packagePricingType = (packageQuantityUnits === 'kg' || packageQuantityUnits === 'g') ? PricingTypes.BY_WEIGHT : PricingTypes.BY_VOLUME;
                        weightInWeightString = true;
                    }
                    else {
                        packageQuantity = quantityMultipler;
                        packageQuantityUnits = `for ${packageQuantity}`;
                        packagePricingType = PricingTypes.BY_EACH;
                        weightInWeightString = false;
                    }
                }
            },
            {
                // Strings in the format 'Each' - no weight, priced by ea
                regex: /^(Each|1ea)$/i,
                process: (result) => {
                    quantityMultipler = 1;
                    packageQuantity = 1;
                    packageQuantityUnits = 'ea';
                    packagePricingType = PricingTypes.BY_EACH;
                    weightInWeightString = false;
                }
            },
            {
                // Strings in the format 'Medium size 1ea' - no weight, priced by ea
                regex: /Medium size 1ea/i,
                process: (result) => {
                    quantityMultipler = 1;
                    packageQuantity = 1;
                    packageQuantityUnits = 'ea';
                    packagePricingType = PricingTypes.BY_EACH;
                    weightInWeightString = false;
                }
            }
        ];

        for (let { regex, process } of patterns) {
            const result = regex.exec(this.#domWeightString);
            if (result) {
                process(result);
                const values = {
                    quantity:       packageQuantity,
                    quantityUnits:  packageQuantityUnits,
                    numItems:       quantityMultipler,
                    pricingType:    packagePricingType,
                    hasWeight:      weightInWeightString
                };

                return values;
            }
        }
        return null;
    }

    #parseQuantityAndUnitsFromPriceString() {
        // Look for a numeric value preceeded by 'g' or 'kg'
        let regex = /(\d{1,3})(g|kg)/i;
        let result = regex.exec(this.#domProductTitleString);
        if (result) {
            const values = {
                quantity:       parseInt(result[1]),
                quantityUnits:  result[2]
            };
            return normalizeQuantityAndUnits(values);
        }
        return 0;
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

                // Populate the product info object
                const product = new ProductPriceAndWeightInfo(element)

                // Add the unit price to the card element as a new data value
                element.setAttribute('data-sort-value-a', product.pricingType);
                element.setAttribute('data-sort-value-b', product.sortableUnitPrice);

                // Find the image element and add a title attribute showing the unit price string
                let img = element.querySelector('img');
                img.setAttribute('title', `PV: ${product.productVariation}, Price: ${product.friendlyPriceString}`);

                // Set the background color of the product card
                element.style.backgroundColor = product.unitPricePerItem === Infinity
                    ? 'red'
                    : getBackgroundColor(product.pricingType);

                // // Capture the output while we're debugging.
                // console.log(`Weight string: ${product.weightString} => Quantity: ${product.packQuantity}, Weight: ${product.weight}, ` +
                //     `Units: ${product.units}, Price: ${product.advertisedPrice}, ` +
                //     `Calc. Unit Price: ${product.friendlyPriceString}`);
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

function parseNumberOfItemsFromPriceString (productTitle) {
    // Look for a numeric value preceeded by 'pk' or 'pack'
    let regex = RegExp('^.*?(\\d{1,3})(?:pk|pack).*?$', 'gi');
    let result = regex.exec(productTitle);
    if (result) {
        qty = parseInt(result[1]);
        return qty;
    }

    return 0;
}

function normalizeQuantityAndUnits(values) {
    if (values) {
        if (values.quantityUnits === 'g' || values.quantityUnits === 'mL') {
            values.quantity /= 1000;
            values.quantityUnits = (values.quantityUnits === 'g') ? 'kg' : 'L';
        }
    }
    return values;
}

const PricingTypes = Object.freeze({
    BY_WEIGHT:  1,
    BY_VOLUME:  2,
    BY_EACH:    3
})

const ProductVariations = Object.freeze({
    PRODUCT_1:  1,
    PRODUCT_2:  2,
    PRODUCT_3:  3,
    PRODUCT_4:  4,
    PRODUCT_5:  5,
    PRODUCT_6:  6,
    PRODUCT_7:  7,
    PRODUCT_8:  8
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