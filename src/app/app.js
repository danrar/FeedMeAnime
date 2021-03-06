import * as _ from "lodash";
import * as slugify from "slugify";
import * as forage from "localforage";
import * as CryptoJS from "crypto-js";
import * as fuzzyset from "fuzzyset.js";
import { Logger } from "./logger";
import { chromeStorageSyncDriver } from "./drivers/sync.driver";
import { chromeStorageLocalDriver } from "./drivers/local.driver";
import "../styles/theme.css";
import "./fonts";

const logger = new Logger();
const FeedMeAnime = {
    storage: {
        local: null,
        sync: null,
        global: null
    }
};
const pageState = {
    themes: {
        Console: "Console",
        BlackWhite: "BlackWhite",
        Smooth: "Smooth"
    },
    animeListings: [],
    anime: [],
    rssFeeds: [{
        title: "Crunchyroll Anime",
        url: "https://www.crunchyroll.com/rss/anime?lang=enGB",
        titleField: 'title',
        linkField: 'link',
        active: true
    }],
    rssContents: [],
    suggestions: {
        count: 200,
        display: 40,
        items: []
    },
    seenHashes: [],
    archivedObjects: [],
    filters: [],
    thumbnails: [],
    lastCacheTime: new Date(),
    loadTime: $.now(),
    settings: {
        theme: "Smooth",
        labelAsTag: false,
        parseLinks: false,
        consolidateResults: false,
        advanced: false,
        labels: false,
        tutorial: true,
        labelFormat: "{0} (A)"
    },
    feedFuzzyset: null,
    tutorial: {
        tutorialPart: 0,

        tutorialStep: 0,
        tutorialPath: []
    }

    //To Add
    //setting remove duplicates
    //setting infohash to magnet link
}

if (!String.prototype.format) {
    String.prototype.format = function () {
        var args = arguments;
        return this.replace(/{(\d+)}/g, function (match, number) {
            return typeof args[number] != 'undefined' ? args[number] : match;
        });
    };
}

String.prototype.formatWithObject = function (object) {
    return this.replace(/{(\w+)}/g, function (match, field) {
        return typeof object[field] != 'undefined' ? object[field] : match;
    }); 
}

FeedMeAnime.setSettings = function () {
    logger.debug("Updating app settings!");
    $.each(pageState.themes, (index, value) => {
        const opts = $("<option/>").attr("value", index).text(value);
        if (pageState.settings.theme === value) {
            $("#themes-select").append(opts.attr("selected", "selected"));
        } else {
            $("#themes-select").append(opts);
        }
    });

    $("#label-tag-checkbox").prop("checked", pageState.settings.labelAsTag);
    $("#parse-links-checkbox").prop("checked", pageState.settings.parseLinks);
    $("#consolidate-results-checkbox").prop("checked", pageState.settings.consolidateResults);
    $("#advanced-checkbox").prop("checked", pageState.settings.advanced);
    $("#labels-checkbox").prop("checked", pageState.settings.labels);
    $("#tutorial-checkbox").prop("checked", pageState.settings.tutorial);
    $("#label-format-input").val(pageState.settings.labelFormat);
}

FeedMeAnime.initStorage = async function () {
    logger.debug("Initializing storages!");
    await forage.defineDriver(chromeStorageLocalDriver);
    await forage.defineDriver(chromeStorageSyncDriver);
    this.storage.local = forage.createInstance({ name: "local", driver: "chromeStorageLocalDriver" });
    this.storage.sync = forage.createInstance({ name: "sync", driver: "chromeStorageSyncDriver" });
    this.storage.global = forage.createInstance({ name: "global", driver: forage.INDEXEDDB });
}

FeedMeAnime.initialize = async function () {
    logger.debug("Initializing application!");
    await this.initStorage();

    const cache = await this.storage.sync.getItem("cacheSettings");
    if (cache != null) {
        pageState.settings = cache;
    }

    FeedMeAnime.setSettings();

    //pageState.filters.push({ title: "Nyaa.si", field: "nyaa:categoryId", operator: "equals", value: "1_2" });
    //_.set(pageState.filters, "Nyaa.si", "nyaa:categoryId,1_2");

    $("head").append($('<link rel="stylesheet type="text/css" />').attr("href", `content/css/${pageState.settings.theme}.css`));
    $("body").addClass(`theme-${slugify(pageState.settings.theme, { lower: true })}`);

    // Load the thumbnail cache
    const thumbnailCache = await this.storage.local.getItem("thumbnailCache");
    if (thumbnailCache != null) {
        pageState.thumbnails = thumbnailCache;
    }

    // Load the anime cache
    const animeCache = await this.storage.sync.getItem("animeList");
    if (animeCache != null) {
        pageState.anime = animeCache;
        for (let title of pageState.anime) {
            this.addThumbnail(title.title, title.thumbnailUrl);
        }
    }

    // Load the rssFeeds
    const rssFeeds = await this.storage.sync.getItem("rssFeeds");
    if (rssFeeds != null) {
        pageState.rssFeeds = rssFeeds;
    }

    const seenHashes = await this.storage.sync.getItem("seenHashes");
    if (seenHashes != null) {
        pageState.seenHashes = seenHashes;
        if (pageState.seenHashes.length > 30)
        {
            var len = pageState.seenHashes.length - 30;
            pageState.seenHashes.splice(0, len);
        }
    }

    const archivedObjects = await this.storage.sync.getItem("archivedObjects");
    if (archivedObjects != null) {
        pageState.archivedObjects = archivedObjects;
    }

    const filters = await this.storage.sync.getItem("filters");
    if (filters != null) {
        pageState.filters = filters;
    }

    const cacheTimeString = await this.storage.sync.getItem("cacheTimeString");
    let maxCache = null;
    if (cacheTimeString != null && _.has(cacheTimeString, "date")) {
        var timeString = _.get(cacheTimeString, "date");
        maxCache = new Date(new Date(timeString).getTime() + 1800000);
    }

    $(document).ajaxStart(function() {
        $('#loading-icon').show();
    }).ajaxStop(function() {
        $('#loading-icon').hide();
    })

    if (maxCache && maxCache > pageState.loadTime) {
        const animeListings = await this.storage.local.getItem("animeListings");
        if (animeListings != null) {
            pageState.animeListings = animeListings;
        }

        await this.sync();

        const suggestions = await this.storage.local.getItem("suggestions");
        if (suggestions != null) {
            pageState.suggestions.items = suggestions;
        }
    } else {
        pageState.animeListings = [];
        await this.sync();
        pageState.suggestions.items = [];
        await this.getSuggestions();
    }

    if (pageState.settings.advanced) {
        $('#anime-advanced-options').show();
        $('#feed-advanced-options').show();
    }

    if (pageState.settings.tutorial) {
        this.pushTutorial();
    }

    pageState.feedFuzzyset = FuzzySet();
}

FeedMeAnime.getRss = async function (feed, skipCache = false) {
    try {
            const res = await $.ajax({
                url: `http://feedmeanimeapi.azurewebsites.net/rss?skipCache=${skipCache}&rssUrl=${feed.url}`,
                type: "GET",
                cache: false,
                dataType: "json"
            });
            return res;
            //return $.xml2json(res);
        } catch (err) {
            console.log(err);
            this.pushNotification("No response from " + feed.title);
            return null;
        }
}

FeedMeAnime.sync = async function () {
    $("#main").html("");
    if (pageState.animeListings.length == 0 && pageState.rssFeeds.length > 0) {

        await this.updateFeedContents();

        for (var i = 0; i < pageState.rssFeeds.length; i++) {
            var feed = pageState.rssFeeds[i];
            if(feed.active || feed.active == undefined) {
                var contenti = pageState.rssContents.indexOf(this.getObjects(pageState.rssContents, 'title', feed.title)[0]);
    
                if (contenti >= 0) {
                    for (var j = 0; j < pageState.anime.length; j++) {

                        let results = this.getObjectsMultiValues(pageState.rssContents[contenti].contents, "title", [pageState.anime[j].nickname, pageState.anime[j].title]);

                        for (var l = 0; l < results.length; l++) {
                            pageState.animeListings.push({ title: results[l][feed.titleField], link: results[l][feed.linkField], feed: feed.title })
                        }



                        //var nicknameResults = this.getObjects(pageState.rssContents[contenti].contents, feed.titleField, pageState.anime[j].nickname);
                        //var titleResults = this.getObjects(pageState.rssContents[contenti].contents, feed.titleField, pageState.anime[j].title);
    //
                        //for (var k = 0; k < nicknameResults.length; k++) {
                        //    pageState.animeListings.push({ title: nicknameResults[k][feed.titleField], link: nicknameResults[k][feed.linkField] })
                        //}
    //
                        //for (var l = 0; l < titleResults.length; l++) {
                        //    if (this.getObjects(pageState.animeListings, 'title', pageState.anime[j].title).length < 1) {
                        //        pageState.animeListings.push({ title: titleResults[l][feed.titleField], link: titleResults[l][feed.linkField] })
                        //    }
                        //}
                    }
                }
            }
        }

        let cacheTime = new Date().getTime();
        let cacheTimeString = {
            "date": cacheTime
        }
        await this.storage.sync.setItem("cacheTimeString", cacheTimeString);
    }

    await this.storage.local.setItem("animeListings", pageState.animeListings);

    if (pageState.animeListings.length === 0) {
        $("#main").append(`<div class="no-anime-text">No anime you are following are present in your active RSS feeds currently.</div>`);
        return;
    }

    var toReorder = [];
    for (let title of pageState.anime) {

        let results = this.getObjectsMultiValues(pageState.animeListings, "title", [title.nickname, title.title]); //, title.label ? title.label : ''

        if (results.length === 0) {
            continue;
        }

        let labelObject = {
            'title': title.title,
            'nickname': title.nickname
            //'feed': feed.title,
            //'feedUrl': feed.url                                                                                                    
        }

        if (title.label) {
            labelObject.label = title.label;
        } else {
            labelObject.label = title.nickname;
        }

        //let labelFormat = pageState.settings.labelFormat;

        //let tagText = labelFormat.formatWithObject(labelObject);

        let imgString = "";

        if (pageState.thumbnails) {
            let thumb = this.getObjectsMultiValues(pageState.thumbnails, "title", [title.nickname, title.title]);

            //let thumb = this.getObjects(pageState.thumbnails, "title", title.nickname);
//
            //if (thumb.length == 0) {
            //    thumb = this.getObjects(pageState.thumbnails, "title", title.title);
            //}

            if (thumb.length > 0) {
                imgString = `<img class="anime-thumbnail" src="${thumb[0].data}"/>`;
            }
        }

        if(pageState.settings.consolidateResults) {
            FeedMeAnime.consolidateResults(results, title, imgString, labelObject);
        } else {
            var array = await FeedMeAnime.listResults(results, title, imgString, labelObject);
            toReorder.push.apply(toReorder, array);
        }
    }

    _.forEach(toReorder, (val) => {
        FeedMeAnime.setAnimeSeen($('#' + val));
    });
}

FeedMeAnime.processFilters = function(obj, filters) {
    _.forEach(filters, (val) => {
        this.filterObjects(obj, val.field, val.value)
    })
}

FeedMeAnime.filterObjects = function (obj, filterField, filterValue) {
    var objects = [];

    objects = this.getObjects(obj, filterField, filterValue);

    return objects;
}

FeedMeAnime.getObjectsMultiValues = function (obj, key, valArray) {
    let objects = [];
    // Deduplicate terms in val array
    let unique = _.uniq(valArray)
    _.forEach(unique, (val) => {
        objects = _.concat(objects, this.getObjects(obj, key, val));
    });
    // Deduplicate results
    return _.uniq(objects);
}


FeedMeAnime.getObjects = function (obj, key, val) {
    var objects = [];
    for (var i in obj) {
        if (!obj.hasOwnProperty(i)) {
            continue;
        }

        if (typeof obj[i] == 'object') {
            objects = objects.concat(this.getObjects(obj[i], key, val));
        } else {
            if (i == key && ~obj[i].toString().indexOf(val) || i == key && obj[i].toString() == val || i == key && val == '') { //
                objects.push(obj);
            } else if (~obj[i].toString().indexOf(val) && key == '') {
                if (objects.lastIndexOf(obj) == -1) {
                    objects.push(obj);
                }
            }
        }
    }
    return objects;
}

FeedMeAnime.pushNotification = function (message) {
    const note = $(`<div class="notification">${message} <div class="icon notification-close"><i class="fa fa-times"></i></div></div>`);
    $("#notifications").append(note);
    note.animate({ "top": "-16px" }).delay(7000).fadeOut(300, function () {
        $(this).remove();
    });
}

FeedMeAnime.pushTutorial = function () {
    const note = $(`<div class="notification" id="tutorial-notification">
                        <div class="icon notification-close"><i class="fa fa-times"></i></div>
                        <div class="title">New?</div>
                        <div class="message">Check out the tutorial!</div>
                        <div id="tutorial-start-button"><i class="fas fa-play"></i></div>
                    </div>`);
    $("#notifications").append(note);
    note.animate({ "top": "-16px" }).delay(14000).fadeOut(300, function () {
        $(this).remove();
        FMA.endTutorial();
    });

    /*
    <div class="title">It looks like you are new to Feed Me Anime!</div>
                        <div class="message">Why not check out the tutorial for a quick how to.</div>
     */
}

FeedMeAnime.clearCache = async function () {
    pageState.animeListings = [];
    await this.storage.local.setItem("animeListings", pageState.animeListings);
}

FeedMeAnime.clearStorage = async function () {
    if (confirm("Are you sure you want to clear all storage?")) {
        await this.storage.local.clear();
        await this.storage.sync.clear();
        await this.storage.global.clear();
    }
}

FeedMeAnime.getPopular = async function (offset) {
    try {
        const res = await $.ajax({
            url: `https://kitsu.io/api/edge/anime?filter[status]=current&filter[subtype]=TV&page[limit]=20&page[offset]=${offset}&sort=popularityRank&fields[anime]=canonicalTitle,posterImage,titles`,
            cache: false,
            dataType: "json"
        });
        return res;
    } catch {
        this.pushNotification("Could not get listing of popular anime.");
        return null;
    }
}

FeedMeAnime.getAnimeDetails = async function (searchText) {
    try {
        const res = await $.ajax({
            url: `https://kitsu.io/api/edge/anime?filter[text]=${searchText}&page[limit]=1&fields[anime]=canonicalTitle,posterImage,titles`,
            cache: false,
            dataType: "json"
        });
        return res;
    } catch {
        this.pushNotification("Could not retrieve any anime details.");
        return null;
    }
}

FeedMeAnime.reloadAnime = function () {
    let animeLength = pageState.anime.length;
    $("#anime-entries").html("");

    if (animeLength > 0) {
        for (let i = 0; i < animeLength; i++) {
            let animeTitle;
            let animeNickname;
            let animeLabelRaw = "";
            let displayText;
            let labelText = "";

            let anime = pageState.anime[i];

            if (anime.nickname != anime.title) {
                displayText = `${anime.nickname} - ${anime.title}`;
            } else {
                displayText = anime.title;
            }

            animeNickname = anime.nickname;
            animeTitle = anime.title;

            if (anime.label) {
                let animeLabel = anime.label;
                animeLabelRaw = ` data-label="${animeLabel}"`;
                displayText = `${displayText} - ${animeLabel}`;
            }

            if (pageState.settings.labels) {
                labelText = `
                    <div class="icon change-label" title="Change Label">
                        <i class="fa fa-tag"></i>
                    </div>`;
            }

            $("#anime-entries").append(`
                <div data-index="${i}" data-nickname="${animeNickname}" data-title="${animeTitle}" ${animeLabelRaw} data-thumbnailurl="${anime.thumbnailUrl}" class="anime-title">
                    <div class="icon remove-anime" title="Delete">
                        <i class="fa fa-times"></i>
                    </div>
                    <div class="icon archive-anime" title="Archive">
                        <i class="fa fa-archive"></i>
                    </div>
                    ${labelText}
                    <div class="icon change-nickname" title="Change Nickname">
                        <i class="fa fa-pencil-alt"></i>
                    </div>
                    ${displayText}
                </div>
            `);
        }
    }
}

FeedMeAnime.reloadFeeds = function () {
    $("#feed-info").html('<div id="feed-info-title">Feeds</div>');
    if (pageState.rssFeeds.length > 0) {
        //this.updateFeedContents();

        for (let i = 0; i < pageState.rssFeeds.length; i++) {
            const feed = pageState.rssFeeds[i];
            var active = feed.active == undefined ? true : feed.active;
            var boltClass= active ? ` feed-active` : ``;
            $("#feed-info").append(`
                <div data-index="${i}" data-feed-title="${feed.title}" data-feed-url="${feed.url}" data-feed-title-field="${feed.titleField}" data-feed-link-field="${feed.linkField}" data-active="${active}" class="feed">
                    <div class="feed-expand"><i class="fas fa-fw fa-caret-right fa-2x"></i><i class="fas fa-fw fa-caret-down fa-2x"></i></div>
                    <div class="icon remove-feed">
                        <i class="fa fa-times fa-lg"></i>
                    </div>
                    <div class="icon archive-feed" title="Archive">
                        <i class="fa fa-archive fa-lg"></i>
                    </div>
                    <div class="icon deactivate-feed${boltClass}">
                        <i class="fa fa-plug fa-lg"></i>
                    </div>
                    <div class="feed-title-text">${feed.title}</div>
                    <div class="feed-url-text"><span><a href="${feed.url}" title="${feed.url}" target="_blank">${feed.url}</a></span></div>
                </div>
                <div data-feed-title="${feed.title}" class="feed-contents">
                </div>
            `);
        }
    }
}

FeedMeAnime.reloadSettingsFilters = function () {
    $("#filters-feed-select").html('');
    _.forEach(pageState.rssFeeds, (feed) => {
        const opts = $("<option/>").attr("value", feed.title).text(feed.title);
        $("#filters-feed-select").append(opts);
    });
    $("#filters-feed-select option").first().attr("selected", "selected");
    this.reloadFeedFilters();
}

FeedMeAnime.reloadFeedFilters = function () {
    var feed = $("#filters-feed-select").children("option").filter(":selected").attr('value');
    $("#filter-configuration").html('');

    var filters = this.getObjects(pageState.filters, 'title', feed)
    if (Object.keys(filters).length > 0) {
        _.forEach(filters, (filter) => {
            var operator = "", operatorNot = "";
            switch (filter.operator){
                case "equals":
                    operator = "selected=selected";
                    break;
                case "notEquals":
                    operatorNot = "selected=selected";
                    break;
            }

            $("#filter-configuration").prepend(`
                <div class="filter" data-feed="${feed}">
                    <input type="text" class="rq-form-element filter-field-input" data-field="${filter.field}" value="${filter.field}" />
                    <select class="filter-operator" id="filter" name="operator">
                      <option value="equals" ${operator}>Equals</option>
                      <option value="notEquals" ${operatorNot}>Not equals</option>
                    </select>
                    <input type="text" class="rq-form-element filter-value-input" data-value="${filter.value}" value="${filter.value}" />
                    <div class="icon update-filter" alt="Update">
                        <i class="fas fa-pencil-alt"></i>
                    </div>
                    <div class="icon remove-filter" alt="Remove">
                        <i class="fa fa-times"></i>
                    </div>
                </div>
            `);
        });
    }

    $("#filter-configuration").prepend(`
        <div class="filter" id="filter-new" data-feed="${feed}">
            <input type="text" class="rq-form-element filter-field-input" placeholder="Field Name" />
            <select class="filter-operator" name="operator">
              <option value="equals">Equals</option>
              <option value="notEquals">Not equals</option>
            </select>
            <input type="text" class="rq-form-element filter-value-input" placeholder="Expected Value" />
            <div class="icon" id="add-filter" alt="Add">
                <i class="fa fa-arrow-alt-circle-right"></i>
            </div>
        </div>`);
    $("#filter-new option").first().attr("selected", "selected");
}

FeedMeAnime.addFilter = async function (fFeed, fField, fOperator, fValue) {
    pageState.filters.push({ title: fFeed, field: fField, operator: fOperator, value: fValue });
}

FeedMeAnime.reloadStorageStats = function () {
    chrome.storage.sync.getBytesInUse(null, function (data) {
        $('#sync-storage-bar').css('width', (data / chrome.storage.sync.QUOTA_BYTES) * 100 + '%');
        $("#storage-sync-text").html(`${data} / ${chrome.storage.sync.QUOTA_BYTES}`);
    });

    chrome.storage.local.getBytesInUse(null, function (data) {
        $('#local-storage-bar').css('width', ((data / chrome.storage.local.QUOTA_BYTES) * 100) + '%');
        $("#storage-local-text").html(`${data} / ${chrome.storage.local.QUOTA_BYTES}`);
    });
}

FeedMeAnime.reloadArchivedObjects = function () {
    $('#archive-list').html(``);
    let archiveHtml = "";
    if(pageState.archivedObjects.length > 0){
        _.forEach(pageState.archivedObjects, (object) => {
            archiveHtml = archiveHtml + `<div class="archive-object">${object}<div class="archive-return-button"></div></div>`;
        });
    } else {
        archiveHtml = "No archived items";
    }
    $('#archive-list').html(`${archiveHtml}`);
}

FeedMeAnime.reloadMain = function () {
    $('#overlay').show();
    $('#overlay').animate({
        opacity: 1
    }, 500, async function () {
        await FMA.sync();
        $('.active-tab').removeClass('active-tab');
        $('#sync').addClass('active-tab');
        $('.content').hide();
        $('#main').show();
        $('#main-refresh').show();
        $('#overlay').animate({ opacity: 0 }, 500, function () {
            $('#overlay').hide();
        });
    });
}

FeedMeAnime.loadSuggestions = async function () {
    $("#anime-suggestions-options").html("");
    let i = 0;
    _.forEach(pageState.suggestions.items, (val) => {
        if (i < pageState.suggestions.display) {
            $("#anime-suggestions-options").append(`
                <a class="js-dyna-link" data-link="https://myanimelist.net/search/all?q=${encodeURI(val.attributes["canonicalTitle"])}"><img src="content/imgs/mal.png" class="suggestions-link"></a>
                <a class="js-dyna-link" data-link="https://www.crunchyroll.com/search?from=&q=${encodeURI(val.attributes["canonicalTitle"])}"><img src="content/imgs/cr.png" class="suggestions-link"></a>
                <div data-title="${val.attributes["canonicalTitle"]}" data-imageurl="${_.get(val, "attributes.posterImage.tiny")}" class="anime-suggestion">
                    ${val.attributes["canonicalTitle"]}
                </div>`);
        }
        i++;
    });

    if(pageState.settings.advanced) {
        $("#anime-suggestions-options").addClass('anime-suggestions-options-advanced')
    }

    $("#anime-title-input").autocomplete({
        source: pageState.suggestions.items.map(suggestion => suggestion.attributes["canonicalTitle"]),
        minLength: 2
    });
}

FeedMeAnime.updateFeedContents = async function (feedTitle = null, override = false) {
    for (var i = 0; i < pageState.rssFeeds.length; i++) {
        var feedName = pageState.rssFeeds[i].title;
        if ((feedTitle == null || feedName == feedTitle) && (pageState.rssFeeds[i].active || override) ){
            const feed = await this.getRss(pageState.rssFeeds[i]);
            if (feed != null)  {
                var objects = _.get(feed, "rss.channel.item");
                
                var filteredObjects = await this.applyFilters(feedName, objects);
                
                if (pageState.rssContents) {
                    if (this.getObjects(pageState.rssContents, 'title', feedName).length < 1) {
                        pageState.rssContents.push({ title: feedName, contents: filteredObjects });
                    }
                } else {
                    pageState.rssContents = [{ title: feedName, contents: filteredObjects }];
                }  
            }
        }
    }
}

FeedMeAnime.applyFilters = async function(feed, feedObjects) {
    var filters = this.getObjects(pageState.filters, 'title', feed);
    var objects = feedObjects;

    _.forEach(filters, (filter) => {
        switch (filter.operator) {
            case "equals":
                objects = this.getObjects(objects, filter.field, filter.value);
                break;

            case "notEquals":
                var objectsToRemove = this.getObjects(objects, filter.field, filter.value);

                _.pullAll(objects, objectsToRemove);
                
                break;
        }
        
    });

    return objects;
}

FeedMeAnime.loadFuzzyFeedStrings = async function () {
    for (var i = 0; i < pageState.rssFeeds.length; i++) {
        if (pageState.rssFeeds[i].active){
            let feed = this.getObjects(pageState.rssContents, 'title', pageState.rssFeeds[i].title)[0];

            if (!jQuery.isEmptyObject(feed)) {
                let wordBreakdown = [];
                let finalSkipWords = [];
                let first = feed.contents[0][pageState.rssFeeds[i].titleField];
                let firstSplit = null;
                let splitChars = [" ", "_"];
                let alwaysInclude = ["-"];
                let bestSplit = {char: null, splits: 0, results: null};
                let checkPercent = 0.5;
                let cutPercent = 0.9;
                let setSize = feed.contents.length;

                _.forEach(splitChars, (char) => {
                    let results = first.split(char);
                    let length = results.length;
                    if (length > 1 && length > bestSplit.splits) {
                        bestSplit = {char: char, splits: length, results: results};
                    }
                });

                _.forEach(bestSplit.results, (split) => { 
                    if(wordBreakdown.filter(function(object){return object.word === split}).length == 0){
                        wordBreakdown.push({
                           word: split,
                           frequency: 0
                        });
                    }
                });

                let size = Math.round(setSize * checkPercent);

                _.forEach(feed.contents, (entry) => {
                    _.forEach(entry[pageState.rssFeeds[i].titleField].split(bestSplit.char), (val) => {
                        if(wordBreakdown.filter(function(object){return object.word === val}).length > 0){
                            wordBreakdown.find(word => word.word === val).frequency++;
                        }
                    });
                });

                for (var j = 0; j < wordBreakdown.length; j++) {
                    if(wordBreakdown[j].frequency > Math.round(size * cutPercent) && !alwaysInclude.includes(wordBreakdown[j].word)) {
                        finalSkipWords.push(wordBreakdown[j]); 
                    }
                }

                _.forEach(feed.contents, (val) => { 
                    let phrase = val[pageState.rssFeeds[i].titleField];          
                    _.forEach(finalSkipWords, (word) => {
                        phrase = phrase.replace(word.word, '');
                    });
                    pageState.feedFuzzyset.add(phrase);
                });
            }
        }
    }
}

FeedMeAnime.getSuggestions = async function () {
    for (let i = 0; i < pageState.suggestions.count; i = i + 20) {
        let results = await this.getPopular(i);
        _.forEach(results.data, (val) => {
            pageState.suggestions.items.push(val);
        });
    }

    await this.storage.local.setItem("suggestions", pageState.suggestions.items);
}

FeedMeAnime.addThumbnail = async function (title, imageUrl) {
    let self = this;
    if (self.getObjects(pageState.thumbnails, 'title', title).length < 1) {
        await self.getDataUri(imageUrl, async function (dataUri) {
            if (pageState.thumbnails) {
                pageState.thumbnails.push({
                    title: title,
                    data: dataUri
                });
            } else {
                pageState.thumbnails = [
                    {
                        title: title,
                        data: dataUri
                    }
                ]
            }

            await self.storage.local.setItem("thumbnailCache", pageState.thumbnails);
        });
    }
}

FeedMeAnime.listResults = async function(results, title, imgString, labelObject) {
    var hashes = [];


    let labelFormat = pageState.settings.labelFormat;
    

    _.forEach(results, (val) => {

        let feed = this.getObjects(pageState.rssFeeds, "title", val["feed"])[0];

        if (feed) {
            labelObject.feed = feed.title;
            labelObject.url = feed.url;
        }


        let tagText = labelFormat.formatWithObject(labelObject);


        let payoffCode = `<div class="output"><input type="text" class="info-link" value="${val["link"]}"><div class="icon clipboard-magnet-copy" title="Copy to Clipboard"><i class="fa fa-copy"></i></div></div>`;
        var titleHash = CryptoJS.HmacSHA1(val["title"], "password").toString();

        if (pageState.settings.parseLinks) {
            if (!val["link"].includes('magnet:') && (val["link"].includes('www.') || val["link"].includes('http://') || val["link"].includes('https://'))) {
                payoffCode = `<div class="output"><div class="output-link"><a href="${val["link"]}" target="_blank" title="${val["link"]}">${val["title"]}</a></div></div>`;
            }
        }

        let labelText = "";

        if (pageState.settings.labels) {
            labelText = `<input type="text" class="info-label" value="${tagText}"><div class="icon clipboard-title-copy" title="Copy to Clipboard"><i class="fa fa-copy"></i></div>`;
        }
        
        $("#main").append(`<div class="anime-block" id="${titleHash}">
                                    ${imgString}
                                    <div data-title="${val["title"]}" class="result">
                                        <div class="info-title">${val["title"]}</div>
                                        <div class="anime-outputs">
                                            ${labelText}
                                            ${payoffCode}
                                        </div>
                                    </div>
                                    <div class="viewed-overlay"></div>
                                    <div class="anime-seen" title="Seen"><i class="far fa-eye fa-2x"></i></div>
                               </div>`);

       _.forEach(pageState.seenHashes, (val2) => {
            if (val2 == titleHash) {
                hashes.push(val2);
            }
        });
    });

    return hashes;
}

FeedMeAnime.consolidateResults = async function(results, title, imgString, labelObject) { 
    let individualResults = [];

    let labelFormat = pageState.settings.labelFormat;
    //let tagText = labelFormat.formatWithObject(labelObject);

    _.forEach(results, (val) => {
        let payoffCode = `<div class="output"><div class="info-link-title">${val["title"]}</div><input type="text" class="consolidate-info-link" value="${val["link"]}"><div class="icon clipboard-magnet-copy" title="Highlight"><i class="fa fa-copy"></i></div></div>`;

        if (pageState.settings.parseLinks) {
            if (!val["link"].includes('magnet:') && (val["link"].includes('www.') || val["link"].includes('http://') || val["link"].includes('https://'))) {
                payoffCode = `<div class="output"><div class="output-link"><a href="${val["link"]}" target="_blank" title="${val["link"]}">${val["title"]}</a></div></div>`;
            }
        }
        individualResults.push({
            title: val["title"],
            link: val["link"],
            payoff: payoffCode,
            feed: val["feed"]
        })
    });

    if(individualResults.length > 0){
        let allPayoffs = "";
        _.forEach(individualResults, (val) => {

            let feed = this.getObjects(pageState.rssFeeds, "title", val["feed"])[0];

            if (feed) {
                labelObject.feed = feed.title;
                labelObject.url = feed.url;
            }

            allPayoffs = allPayoffs + val["payoff"];
           });
       $("#main").append(`<div class="anime-block">
                                    ${imgString}
                                    <div data-title="${title.title}" class="result">
                                        <div class="info-title">${title.title}</div>
                                        <div class="anime-outputs">
                                            <input type="text" class="info-label" value="${tagText}"><div class="icon clipboard-title-copy" title="Highlight"><i class="fa fa-copy"></i></div>
                                            ${allPayoffs}
                                            </div>
                                    </div>
                                </div>`);
       /*<div class="viewed-overlay"></div>
                                    <div class="anime-seen" title="Seen"><i class="far fa-eye fa-2x"></i></div>*/
    }
}

FeedMeAnime.setAnimeSeen = function(animeBlock) {
    var icon = animeBlock.find('.anime-seen');
    var overlay = animeBlock.find('.viewed-overlay');
    icon.data('toggled', true);
    icon.css({opacity: "1"});
    overlay.show();
    if (pageState.seenHashes.indexOf(animeBlock.attr('id')) == -1) {
        pageState.seenHashes.push(animeBlock.attr('id'));
    }
    $("#main").append(animeBlock);
}

FeedMeAnime.unsetAnimeSeen = function(animeBlock) {
    var icon = animeBlock.find('.anime-seen');
    var overlay = animeBlock.find('.viewed-overlay');
    icon.data('toggled', false);
    icon.css({opacity: "0.3"});
    overlay.hide();

    pageState.seenHashes.splice(pageState.seenHashes.indexOf(animeBlock.attr('id'), 1));

}

FeedMeAnime.startTutorial = async function() {

    const url = chrome.runtime.getURL('content/tutorials/'+ pageState.settings.theme +'.json');

    let response = await fetch(url);
    let test = await response.json()

    var html = ``;
    var part = 0;
    _.forEach(test, (object) => {
        html = html + `<div id="` + object.title + `" class="tutorial-part" data-section-number="` + object.number + `">`;

        pageState.tutorial.tutorialPath.push({
            partName: object.title,
            partNumber: object.number,
            tab: object.tab,
            steps: []
        })

        var step = 0;
        _.forEach(object.steps, (step) => {
            var bubbleStyle = step.class ? " " + step.class : "";
         
            html = html + `<div id="` + object.title + `-step-` + step.number + `" class="tutorial-overlay" data-step="` + step.number + `" style="top: ` + step.highlight.top + `; left: ` + step.highlight.left + `; height: ` + step.highlight.height + `; width: ` + step.highlight.width + `;" >
                            <div class="tutorial-bubble` + bubbleStyle + `" id="` + object.title + `-step-` + step.number + `-bubble" style="left: ` + step.bubble.left + `; top: ` + step.bubble.top + `; width: ` + step.bubble.width + `; height: ` + step.bubble.height + `;">
                            <div class="tutorial-title">
                                <div class="tutorial-step-count">`+ (step.number + 1) +`/`+ Object.keys(object.steps).length +`</div>
                                `+ object.tab  +` - `+ step.bubble.title +`
                            </div>
                            ` + step.bubble.contents + `
                            <i class="fa fa-arrow-left fa-2x bubble-navigate-left" title="Previous Hint"></i><i class="fa fa-arrow-right fa-2x bubble-navigate-right" title="Next Hint"></i><i class="fas fa-times fa-2x tutorial-end-button tutorial-bubble-end-button tutorial-end-hidden" title="End tutorial"></i>
                            </div>
                          </div>`
            pageState.tutorial.tutorialPath[part].steps.push({
                                                            stepNumber: step.number, 
                                                            controlLocation: step.bubble.controlLocation,
                                                            trigger: step.trigger,
                                                            triggerBehaviour: step.triggerBehaviour,
                                                            backgroundImage: step.highlight.backgroundImage,
                                                            backgroundColor: step.highlight.backgroundColor,
                                                        });
            //tutorialPath[part] = tutorialPath[part] + "," +  step; `+ backgroundImage +`
            step++;
        });

        html = html + `</div>`;
        part++;
    });

    console.log(pageState.tutorial.tutorialPath);

    $('#tutorial-contents').html(html);

    this.checkTutorialNavigation();

    this.loadTutorialStep();

    $('#tutorial').show();
    $('#tutorial-disable').show();
}

FeedMeAnime.endTutorial = async function() {
    pageState.settings.tutorial = false;
    $('#tutorial').hide();
    $('#tutorial-disable').hide();
    await FMA.storage.sync.setItem("cacheSettings", pageState.settings);
    $("#tutorial-checkbox").prop("checked", pageState.settings.tutorial);
}

FeedMeAnime.checkTutorialNavigation = function() {
    var part = pageState.tutorial.tutorialPart;
    var step = pageState.tutorial.tutorialStep;
    $('.bubble-navigate-left').removeClass('disabled');
    $('.bubble-navigate-right').removeClass('disabled');
    $('.bubble-navigate-right').removeClass('tutorial-end-hidden');
    $('.tutorial-bubble-end-button').addClass('tutorial-end-hidden');

    if(pageState.tutorial.tutorialPath[part].steps[step].controlLocation != undefined) {
        $('#tutorial-part-controls').removeClass('tutorial-part-controls-bottom');
        $('#tutorial-part-controls').addClass('tutorial-part-controls-top');
    } else {
        $('#tutorial-part-controls').removeClass('tutorial-part-controls-top');
        $('#tutorial-part-controls').addClass('tutorial-part-controls-bottom');
    }

    if (pageState.tutorial.tutorialPath[part].steps[step].triggerBehaviour != undefined) {
        switch (pageState.tutorial.tutorialPath[part].steps[step].triggerBehaviour) {
            case "toggle": 
                $(pageState.tutorial.tutorialPath[part].steps[step].trigger).click(); 
                break;
        }
    }

    if (part == 0 && step == 0) {
        $('.bubble-navigate-left').addClass('disabled');
    }

    var lastPart = pageState.tutorial.tutorialPath[pageState.tutorial.tutorialPath.length-1];

    if (lastPart.partNumber == part) {
        $('#tutorial-skip-part-button').addClass('tutorial-skip-part-inactive');
    } else {
        $('#tutorial-skip-part-button').removeClass('tutorial-skip-part-inactive');
    }

    if (lastPart.partNumber == part && lastPart.steps[lastPart.steps.length-1].stepNumber == step) {
        $('.bubble-navigate-right').addClass('tutorial-end-hidden');
        $('.tutorial-bubble-end-button').removeClass('tutorial-end-hidden');
    }
}

FeedMeAnime.loadTutorialStep = function() {
    $('.tutorial-bubble').hide();
    $('.tutorial-overlay').css('background-color', 'rgba(0,0,0,.7)').css('background-image','unset').hide(); 


    var step = pageState.tutorial.tutorialStep;
    var part = pageState.tutorial.tutorialPart;

    setTimeout(() => {
        if (step != 0 || part != 0) {
             switch (part) {
                    case 0: if(!$('#sync').hasClass('active-tab')){$('#sync').click();} break;
                    case 1: if(!$('#add-anime').hasClass('active-tab')){$('#add-anime').click();} break;
                    case 2: if(!$('#add-feed').hasClass('active-tab')){$('#add-feed').click();} break;
                    case 3: if(!$('#change-settings').hasClass('active-tab')){$('#change-settings').click();} break;
                }
        }
    }, 100);

    var bgColor = pageState.tutorial.tutorialPath[part].steps[step].backgroundColor ? pageState.tutorial.tutorialPath[part].steps[step].backgroundColor : 'unset';
    var bgImage = pageState.tutorial.tutorialPath[part].steps[step].backgroundImage ? 'url(' + pageState.tutorial.tutorialPath[part].steps[step].backgroundImage + ')' : 'unset';

    $(".tutorial-part[data-section-number='"+ part +"'] .tutorial-overlay[data-step='"+ step +"']").show().addClass('tutorial-active');
    setTimeout(() => {
        if (step == 0 && part == 0) {
            if (!$('#sync').hasClass('active-tab')){
                $('#sync').click();
            }

          
            $('.tutorial-overlay').first().css('background-image', bgImage).css('background-color', bgColor).addClass('tutorial-active').show();
            $('.tutorial-overlay').first().children('.tutorial-bubble').show();
        
        } else {
            if (pageState.tutorial.tutorialPath[part].steps[step].triggerBehaviour != undefined) {
            switch (pageState.tutorial.tutorialPath[part].steps[step].triggerBehaviour) {
                case "follow":
                    var target = $(pageState.tutorial.tutorialPath[part].steps[step].trigger);
                    var highlight = $(`div[data-section-number=` + part + `] div[data-step=` + step + `]`);
                    var top = target.offset().top - 5; 
                    var left = target.offset().left - 5; /*parseInt(target.css('padding-left').trimRight('px'), 10) (parseInt(target.css('margin-top'), 10)*/
                    
                    highlight.css('top', top + 'px');
                    highlight.css('left', left + 'px');
                    highlight.css('height', (target.height() + parseInt(target.css('padding-top')) + parseInt(target.css('padding-bottom')) + 10) + 'px');
                    highlight.css('width', (target.width() + parseInt(target.css('padding-left')) + parseInt(target.css('padding-right')) + 10)  + 'px'); 
                        
                    break;
                }
            }
            $(".tutorial-part[data-section-number='"+ part +"'] .tutorial-overlay[data-step='"+ step +"']").css('background-color','unset').css('background-image','unset').css('background-image', bgImage).css('background-color', bgColor);
            $(".tutorial-part[data-section-number='"+ part +"'] .tutorial-overlay[data-step='"+ step +"'] .tutorial-bubble").show();
        }
    }, 800);

    $('#tutorial-controls-text').html(``+ pageState.tutorial.tutorialPath[part].tab);
    this.setPips(part);
}

FeedMeAnime.adhocModal = function(title, content, modalClass, adhocStyle = '') {
    let modal = $('#adhoc-modal');
    let contentContainer = $('#adhoc-modal-content');

    $(contentContainer).addClass(modalClass).attr('style', adhocStyle);
    $(contentContainer).append(`<div id="adhoc-modal-title" class="`+modalClass+`-title">
            `+ title +`
        </div>`);
    $(contentContainer).append(content);

    $('#overlay').show();

    $(modal).show();
}

FeedMeAnime.setPips = function (part) {
    var html = "";
    _.forEach(pageState.tutorial.tutorialPath, (pip) => {
        var active = pip.partNumber <= part ? " pip-active" : "";
        html = html + `<div class="pip` + active + `" data-title="` + pip.tab + `" title="` + pip.tab + `" data-partNumber="` + pip.partNumber +`"></div>`
    });

    $('#pips').html(html);
}

FeedMeAnime.getDataUri = function (url, callback) {
    let image = new Image();
    image.src = url;
    image.onload = function () {
        let canvas = document.createElement("canvas");
        canvas.width = this.naturalWidth;
        canvas.height = this.naturalHeight;
        canvas.getContext("2d").drawImage(this, 0, 0);
        if (url.includes("png")) {
            callback(canvas.toDataURL("image/png"));
        } else {
            callback(canvas.toDataURL("image/jpg"));
        }
    }
}

Array.prototype.remove = function() {
    var what, a = arguments, L = a.length, ax;
    while (L && this.length) {
        what = a[--L];
        while ((ax = this.indexOf(what)) !== -1) {
            this.splice(ax, 1);
        }
    }
    return this;
};


const archive = (field, type, values) => {
    pageState.archivedObjects[type] = values;
}


window.FMA = FeedMeAnime;

/**
 * Page Events
 */

$(document).on("click", ".notification-close", function () {
    $(this).parent().remove();
});

$(document).on("click", "#tutorial-notification .notification-close", function () {
    $('#tutorial-notification').remove();
    FMA.endTutorial();
});

$('#add-anime').click(function () {
    $('#overlay').show();
    $('#overlay').animate({
        opacity: 1
    }, 500, async function () {
        await FMA.reloadAnime();
        await FMA.loadSuggestions();
        $('.active-tab').removeClass('active-tab');
        $('#add-anime').addClass('active-tab');
        $('.content').hide();
        $('#anime-info').show();
        $('#anime-suggestions').show();
        $('#controls').show();
        $('#anime-controls').show();
        $('#overlay').animate({ opacity: 0 }, 500, function () {
            $('#overlay').hide();
        });
    });
});

$('#add-feed').click(function () {
    $('#overlay').show();
    $('#overlay').animate({
        opacity: 1
    }, 500, async function () {
        await FMA.reloadFeeds();
        $('.active-tab').removeClass('active-tab');
        $('#add-feed').addClass('active-tab');
        $('.content').hide();
        $('#feed-info').show();
        $('#controls').show();
        $('#feed-controls').show();
        $('#overlay').animate({ opacity: 0 }, 500, function () {
            $('#overlay').hide();
        });
    });
});

$('#change-settings').click(function () {
    $('#overlay').show();
    $('#overlay').animate({
        opacity: 1
    }, 500, async function () {
        await FMA.reloadSettingsFilters();
        await FMA.reloadStorageStats();
        await FMA.reloadArchivedObjects();
        $('.active-tab').removeClass('active-tab');
        $('#change-settings').addClass('active-tab');
        $('.content').hide();
        $('#sync-storage-bar').width('%');
        $('#settings').show();
        $('#overlay').animate({ opacity: 0 }, 500, function () {
            $('#overlay').hide();
        });
    });
});

$('#sync').click(function () {
    FMA.reloadMain();
});

$(document).on('click', 'a[target="_blank"]', function(e){
    e.preventDefault();
    chrome.tabs.create({url: $(this).prop('href'), active: false});
    return false;
});

$(document).on('click', '.toggle', function () {
    var target = $(this).data('target');
    $(this).children('.fa-fw').toggle();
    $(target).slideToggle();
})

$(document).on('click', '.feed-expand', async function () {
    if(!$(this).attr('data-toggled') || $(this).attr('data-toggled') == 'false'){
        if($(this).parent().data('feed-title') != $(`.feed-expand[data-toggled='true']`).parent().data('feed-title')) {
            $('.feed-expand').each(function () {
        
                let targetFeed = $(this).parent();
                let feedTitle = targetFeed.data('feed-title');
                let feedContentContainer = $(`.feed-contents[data-feed-title='${feedTitle}']`)[0];
                $(this).attr('data-toggled', 'false');
                $(this).find('.fa-caret-down').hide();
                $(this).find('.fa-caret-right').show();
                $(feedContentContainer).slideUp();
            })
        }

        let targetFeed = $(this).parent();
        let feedTitle = targetFeed.data('feed-title');
        let feedTitleField = targetFeed.data('feed-title-field');
        let feedLinkField = targetFeed.data('feed-link-field');
        let feedContentContainer = $(`.feed-contents[data-feed-title='${feedTitle}']`)[0];

        if (!$(this).attr('data-toggled') || $(this).attr('data-toggled') == 'false')  {
            let storeHtml = $(this).html();
            $(this).html('<i class="fa fa-circle-notch fa-spin fa-lg"></i>');
            if (FMA.getObjects(pageState.rssContents, 'title', feedTitle).length == 0) {
                await FMA.updateFeedContents(feedTitle, true);
            }

            let feed = FMA.getObjects(pageState.rssContents, 'title', feedTitle)[0];
            if ($(feedContentContainer).html()) {
                for (let i = 0; i < feed.contents.length; i++) {
                    var entry = feed.contents[i];
                    $(feedContentContainer).append(`
                        <div class="feed-entry" data-item-title="${entry[feedTitleField]}" data-item-link="${entry[feedLinkField]}">
                            <div class="content-title" title="${entry[feedTitleField]}">${entry[feedTitleField]}</div>
                            <div class="content-link" title="${entry[feedLinkField]}"><input type="text" class="info-link" value="${entry[feedLinkField]}"></div>
                            <div class="feed-add-anime" title="Add associated Anime"><i class="fas fa-thumbtack"></i></div>
                        </div>`);
                }
            }
            $(this).html(storeHtml);
            
        } 
        $(feedContentContainer).slideDown();
        $(this).attr('data-toggled', 'true');

        $(this).children('.fa-fw').toggle();
    } else {
        let targetFeed = $(this).parent();
        let feedTitle = targetFeed.data('feed-title');
        let feedContentContainer = $(`.feed-contents[data-feed-title='${feedTitle}']`)[0];
        $(feedContentContainer).slideUp();
        $(this).attr('data-toggled', 'false');
        $(this).children('.fa-fw').toggle();
    }
})

$(document).on('click', '.remove-anime', async function () {
    var index = $(this).parent().data('index');
    if (index > -1) {
        pageState.anime.splice(index, 1);
    }
    await FMA.storage.sync.setItem("animeList", pageState.anime);
    await FMA.reloadAnime();
    await FMA.clearCache();
})

$(document).on('click', '.archive-anime', async function () {
    var index = $(this).parent().data('index');

    if (index > -1) {
        archive('anime', 'anime', pageState.anime[index]);
        pageState.anime.splice(index, 1);
    }

    await FMA.storage.sync.setItem("animeList", pageState.anime);
    await FMA.storage.sync.setItem("archivedObjects", pageState.archivedObjects);
    await FMA.reloadAnime();
    await FMA.clearCache();
})

$(document).on('click', '.remove-feed', async function () {
    var index = $(this).parent().data('index');
    if (index > -1) {
        pageState.rssFeeds.splice(index, 1);
    }

    await FMA.storage.sync.setItem("rssFeeds", pageState.rssFeeds);
    await FMA.reloadFeeds();
    await FMA.clearCache();
})

$(document).on('click', '.archive-feed', async function () {
    var index = $(this).parent().data('index');
    if (index > -1) {
        archive('feed', 'feed', pageState.rssFeeds[index]);
        pageState.rssFeeds.splice(index, 1);
    }

    await FMA.storage.sync.setItem("rssFeeds", pageState.rssFeeds);
    await FMA.storage.sync.setItem("archivedObjects", pageState.archivedObjects);
    await FMA.reloadFeeds();
    await FMA.clearCache();
})

$(document).on('click', '.deactivate-feed', async function () {
    var feed = $(this).closest('.feed')
    if (feed.attr('data-active') == 'true'){
        $(this).removeClass('feed-active');
        feed.attr('data-active', 'false');
        pageState.rssFeeds.find( rss => rss.url === feed.data('feed-url')).active = false;
    } else {
        $(this).addClass('feed-active');
        feed.attr('data-active', 'true');
        pageState.rssFeeds.find( rss => rss.url === feed.data('feed-url')).active = true;
    }

    await FMA.storage.sync.setItem("rssFeeds", pageState.rssFeeds);
    await FMA.clearCache();
})

$(document).on('change', '#filters-feed-select', async function () {
    $('#filters-feed-select option[selected=selected]').removeAttr('selected');
    var selected = $(this[this.selectedIndex]);
    selected.attr('selected', 'selected');
    FMA.reloadFeedFilters();
});

$(document).on('change', '.filter-operator', async function () {
    $(this).find('option[selected=selected]').removeAttr('selected');
    var selected = $(this[this.selectedIndex]);
    selected.attr('selected', 'selected');
});

$(document).on('click', '.remove-filter', async function () {
    var feed = $(this).parent().data('feed');
    var value = $(this).parent().find('.filter-field-input').val();
    _.remove(pageState.filters, function(e) {
        return e.title + e.field == feed + value;
    });
    FMA.pushNotification('' + $(this).parent().data('feed') + ' filter removed');
    $('#filter-changes-warning').show();
    await FMA.reloadFeedFilters();
    await FMA.clearCache();
});

$(document).on('click', '.update-filter', async function () {
    var feed = $(this).parent().data('feed');
    var field = $(this).parent().find('.filter-field-input').val();

    _.remove(pageState.filters, function(e) {
        return e.title === feed && e.field === field;
    });
    
    var operator = $(this).parent().find('.filter-operator [selected=selected]').attr('value');
    var value = $(this).parent().find('.filter-value-input').val();
    await FMA.addFilter(feed, field, operator, value);
    FMA.pushNotification('' + feed + ' filter updated');
    $('#filter-changes-warning').show();
    await FMA.reloadFeedFilters();
});

$(document).on('click', '#save-settings', async function () {
    var reload = false;

    if (pageState.settings.theme != $("#themes-select option:selected").attr('value')) {
        pageState.settings.theme = value;
        reload = true;
    }

    pageState.settings.labelAsTag = $('#label-tag-checkbox').prop('checked');
    pageState.settings.parseLinks = $('#parse-links-checkbox').prop('checked');
    pageState.settings.consolidateResults = $('#consolidate-results-checkbox').prop('checked');
    pageState.settings.advanced = $('#advanced-checkbox').prop('checked');
    pageState.settings.labels = $('#labels-checkbox').prop('checked');
    pageState.settings.labelFormat = $('#label-format-input').val();
    
    if (pageState.settings.tutorial != $('#tutorial-checkbox').prop('checked')) {
        location.reload();
    }
    pageState.settings.tutorial = $('#tutorial-checkbox').prop('checked');

    await FMA.storage.sync.setItem("filters", pageState.filters);
    $('#filter-changes-warning').hide();
    await FMA.storage.sync.setItem("cacheSettings", pageState.settings);
    await FMA.clearCache();
    if(reload){
        location.reload();
    } else {
        FMA.pushNotification('Settings saved');
    }
    
});

$(document).on('click', '.clipboard-title-copy', function () {
    var copyText = $(this).closest('.result').find('.info-label')[0]
    copyText.select();
    document.execCommand("Copy");
});

$(document).on('click', '.clipboard-magnet-copy', function () {
    var copyText = $(this).closest('.output').find('.info-link')[0]
    if(copyText == null){
        copyText = $(this).closest('.output').find('.consolidate-info-link')[0]
    }
    copyText.select();
    document.execCommand("Copy");
});

$(document).on('click', '.anime-seen', async function () {
    var animeBlock = $(this).closest('.anime-block')
    if ($(this).data('toggled')){
        FeedMeAnime.unsetAnimeSeen(animeBlock);
    } else {
        FeedMeAnime.setAnimeSeen(animeBlock);
    }

    await FMA.storage.sync.setItem("seenHashes", pageState.seenHashes);
});

$(document).on('click', '.js-dyna-link', async function() {
    chrome.tabs.create({ url: $(this).attr('data-link') });
})

$(document).on('click', '#clear-cache', async function () {
    await FMA.clearCache();
});

$(document).on('click', '#anime-add-icons', async function () {
    debugger;
    var title = $('#anime-title-input').val();
    var nickname = $('#anime-nickname-input').val();
    var label = $('#anime-label-input').val();
    var thumbnailUrl = $('#anime-thumburl-input').val();
    var otherNames = [];

    if (!title) {
        var error = $('#error-message');
        error.html('Please enter an Anime title to track.').dialog({ appendTo: "#error-wrapper", dialogClass: 'error-position' });
        return;
    }

    if (!nickname) {
        nickname = title;
    }

    if (!thumbnailUrl) {
        let animeDetails = await FMA.getAnimeDetails(title);

        if (animeDetails.data.length == 0) {
            var matchingAnime = pageState.suggestions.items.filter(suggestion => suggestion.attributes['canonicalTitle'] == title);
            if (matchingAnime.length > 0) {
                await FMA.addThumbnail(matchingAnime[0].attributes['canonicalTitle'], matchingAnime[0].attributes.posterImage['tiny']);
                thumbnailUrl = matchingAnime[0].attributes.posterImage['tiny'];
            }
        } else {
            let result = animeDetails.data[0];

            await FMA.addThumbnail(result.attributes["canonicalTitle"], result.attributes.posterImage['tiny']);
            thumbnailUrl = result.attributes.posterImage['tiny'];

            otherNames = result.attributes.titles;
        }
    } else {
        await FMA.addThumbnail(title, thumbnailUrl);
    }

    var selection = { nickname: nickname, title: title, label: label, otherNames: otherNames, thumbnailUrl: thumbnailUrl };

    FMA.pushNotification('Anime ' + nickname + ' added');

    pageState.anime.push(selection);
    await FMA.reloadAnime();
    await FMA.storage.sync.setItem("animeList", pageState.anime);
    await FMA.clearCache();
    $('#anime-title-input').val('');
    $('#anime-nickname-input').val('');
    $('#anime-label-input').val('');
    $('#anime-thumburl-input').val('');
});

$(document).on('click', '#feed-add-icons', async function () {
    var title = $('#feed-title-input').val();
    var url = $('#feed-url-input').val();
    var titleField = $('#feed-titleField-input').val();
    var linkField = $('#feed-linkField-input').val();

    if (!title || !url) {
        var error = $('#error-message');
        error.html('Every feed needs both a title and a url to it\'s contents').dialog({ appendTo: "#error-wrapper", dialogClass: 'error-position' });
        return;
    }

    if (!titleField) {
        titleField = 'title';
    }

    if (!linkField) {
        linkField = 'link';
    }

    pageState.rssFeeds.push({ title: title, url: url, titleField: titleField, linkField: linkField, active: true });

    await FMA.reloadFeeds();
    await FMA.storage.sync.setItem("rssFeeds", pageState.rssFeeds);
    await FMA.clearCache();

    FMA.pushNotification('Feed ' + title + ' added');

    $('#feed-title-input').val('');
    $('#feed-url-input').val('');
    $('#feed-titleField-input').val('');
    $('#feed-linkField-input').val('');

});

$(document).on('click', '.anime-suggestion-result', async function () {
    let title = $(this).data('title');
    let thumbUrl = $(this).data('imageurl');
    let nickname = prompt("Give " + title + " a nickname? (Leave blank for no nickname)");
    if (nickname === null) {
        return;
    } else if (!nickname) {
        nickname = title;
    }
    var selection = { nickname: nickname, title: title, thumbnailUrl: thumbUrl };
    pageState.anime.push(selection);

    FMA.pushNotification('Anime ' + nickname + ' added');
    await FMA.reloadAnime();
    await FMA.storage.sync.setItem("animeList", pageState.anime);
    await FMA.clearCache();
    await FMA.getDataUri(thumbUrl, async function (dataUri) {
        if (pageState.thumbnails) {
            pageState.thumbnails.push({ title: title, data: dataUri });
        } else {
            pageState.thumbnails = [{ title: title, data: dataUri }];
        }
        await FMA.storage.local.setItem("thumbnailCache", pageState.thumbnails);
    });
    $('#adhoc-modal-close').click();
});

$(document).on('click', '#label-format-description', async function() {
    let html = '';

    html = html + (`<div class="label-formatting-content">
            Format your label and include details about the episode in question.<br />
            The details avaliable to you are:<br /><br />
<div style="width: 110px; display: inline-block;"><strong>Anime Title</strong></div>        <div style="width: 180px; display: inline-block;">{title}</div>
<div style="width: 110px; display: inline-block;"><strong>Anime Nickname</strong></div>     <div style="width: 180px; display: inline-block;">{nickname} - This default to title</div>
<div style="width: 110px; display: inline-block;"><strong>Anime Label</strong></div>        <div style="width: 180px; display: inline-block;">{label} - This defaults to nickname</div>
<div style="width: 110px; display: inline-block;"><strong>Feed Title</strong></div>         <div style="width: 180px; display: inline-block;">{feed}</div>
<div style="width: 110px; display: inline-block;"><strong>Feed URL</strong></div>           <div style="width: 180px; display: inline-block;">{url}</div><br /><br />
            <strong>Example</strong><br />&emsp;{title} - {feed} (A)<br />
            <strong>Output</strong><br />&emsp;Darwin's Game - Crunchy Roll Anime (A)
        </div>`);

    FMA.adhocModal('Label Formatting', html, 'label-formatting', 'height: 260px;');
});

$(document).on('click', '.anime-suggestion', async function () {
    if(pageState.feedFuzzyset.length() == 0)
    {
        await FMA.updateFeedContents();
        await FMA.loadFuzzyFeedStrings();
    }


    let title = $(this).data('title');
    let thumbUrl = $(this).data('imageurl');
    let html = '';
    let modalClass = 'suggestions-modal';

    html = html + (`<div class="suggestion-modal-title">${title}</div><div class="suggestion-modal-content">`);

    let results = pageState.feedFuzzyset.get(title);

    if (html && results != null) {
        html = html + `Here are the results in your feed that we think match this title.<br />`;
        _.forEach(results, (result) => { 
            if(result[0] > 0.3){
                result[1] = result[1].trim().replace(/\d+$/, "").trim().replace(/\-$/, '').trim();
                html = html + `<div class="anime-suggestion-result" data-title="${result[1]}" data-imageurl="${thumbUrl}">${result[1]} <div class="suggestion-add-button">Add</div></div>`;
            }
        });
    } else {
        html = html + `We don't detect any Anime with this title currently within your active feeds. <br />
            This may be due to the title being a different language or containing large differences than this suggestion.<br />
            Or, there's just not any results for it in any of your feeds.<br />
            Would you like to add this Anime anyway?
            <div class="anime-suggestion-result" data-title="${title}" data-imageurl="${thumbUrl}"><div class="suggestion-add-button">Add</div></div>`;
    }

    html = html + `</div>`;

    FMA.adhocModal(title, html, modalClass);
});

$(document).on('click', '#adhoc-modal-close', async function () { 
    let modal = $('#adhoc-modal');
    let content = $('#adhoc-modal-content');
    $(content).html('');
    $('#overlay').hide();
    $(modal).hide();

});

$(document).on('click', '.feed-add-anime', async function () {
    let itemTitle = $(this).parent().data('item-title');
    let thumbnailUrl;
    let nickname;
    let title = prompt("Please trim the title down to the Anime name", itemTitle);

    if (title === null) {
        return;
    } else {
        nickname = title;
    }

    if (!thumbnailUrl) {
        var matchingAnime = pageState.suggestions.items.filter(suggestion => suggestion.attributes['canonicalTitle'] == title);
        if (matchingAnime.length > 0) {
            await FMA.addThumbnail(matchingAnime[0].attributes['canonicalTitle'], matchingAnime[0].attributes.posterImage['tiny']);
            thumbnailUrl = matchingAnime[0].attributes.posterImage['tiny'];
        }
    }

    var selection = { nickname: nickname, title: title, thumbnailUrl: thumbnailUrl };
    pageState.anime.push(selection);

    FMA.pushNotification('Anime ' + nickname + ' added');
    await FMA.reloadAnime();
    await FMA.storage.sync.setItem("animeList", pageState.anime);
    await FMA.clearCache();
    await FMA.getDataUri(thumbUrl, async function (dataUri) {
        if (pageState.thumbnails) {
            pageState.thumbnails.push({ title: title, data: dataUri });
        } else {
            pageState.thumbnails = [{ title: title, data: dataUri }];
        }
        await FMA.storage.local.setItem("thumbnailCache", pageState.thumbnails);
    });
});

$(document).on('click', '.change-label', async function () {
    var index = $(this).parent().data('index');
    var nickname = $(this).parent().data('nickname');
    var title = $(this).parent().data('title');
    var label = $(this).parent().data('label');

    var newLabel = '';

    if (label) {
        newLabel = prompt("Change label for " + nickname + "?", label)
    } else {
        newLabel = prompt("Give " + nickname + " a label?");
    }

    if (newLabel === null) {
        return;
    } else if (newLabel) {
        pageState.anime[index].label = newLabel;
    } else {
        pageState.anime[index].label = "";
    }

    FMA.pushNotification('Label changed');

    await FMA.reloadAnime();
    await FMA.storage.sync.setItem("animeList", pageState.anime);
    await FMA.clearCache();
});

$(document).on('click', '.change-nickname', async function () {
    var index = $(this).parent().data('index');
    var nickname = $(this).parent().data('nickname');
    var title = $(this).parent().data('title');
    var label = $(this).parent().data('label');

    var newNick = '';

    if (label) {
        newNick = prompt("Change nickname for " + nickname + "?", nickname)
    } else {
        newNick = prompt("Give " + title + " a nickname?");
    }

    if (newNick === null) {
        return;
    } else if (newNick) {
        pageState.anime[index].nickname = newNick;
    } else {
        pageState.anime[index].nickname = title;
    }
    FMA.pushNotification('Nickname changed');

    await FMA.reloadAnime();
    await FMA.storage.sync.setItem("animeList", pageState.anime);
    await FMA.clearCache();
});

$(document).on('click', '.bubble-navigate-left', async function () {
    var part = pageState.tutorial.tutorialPart;
    var step = pageState.tutorial.tutorialStep;

    if (pageState.tutorial.tutorialPath[pageState.tutorial.tutorialPart].steps[0].stepNumber < pageState.tutorial.tutorialStep) {
        if(pageState.tutorial.tutorialPath[part].steps[step].triggerBehaviour != undefined) {
            switch (pageState.tutorial.tutorialPath[part].steps[step].triggerBehaviour) {
                case "toggle": $(pageState.tutorial.tutorialPath[part].steps[step].trigger).click(); break;
            }
        }

        $('.tutorial-active').removeClass('tutorial-active');
        pageState.tutorial.tutorialStep--;
    } else if (pageState.tutorial.tutorialPath[pageState.tutorial.tutorialPart-1] != undefined) {
        $('.tutorial-active').removeClass('tutorial-active');
        pageState.tutorial.tutorialPart--;
        pageState.tutorial.tutorialStep = pageState.tutorial.tutorialPath[pageState.tutorial.tutorialPart].steps[pageState.tutorial.tutorialPath[pageState.tutorial.tutorialPart].steps.length-1].stepNumber;
    }

    FMA.checkTutorialNavigation();
    FMA.loadTutorialStep();
});

$(document).on('click', '.bubble-navigate-right', async function () {
    var part = pageState.tutorial.tutorialPart;
    var step = pageState.tutorial.tutorialStep;

    if (pageState.tutorial.tutorialPath[part].steps[pageState.tutorial.tutorialPath[part].steps.length-1].stepNumber > pageState.tutorial.tutorialStep) {
        if(pageState.tutorial.tutorialPath[part].steps[step].triggerBehaviour != undefined) {
            switch (pageState.tutorial.tutorialPath[part].steps[step].triggerBehaviour) {
                case "toggle": $(pageState.tutorial.tutorialPath[part].steps[step].trigger).click(); break;
            }
        }
        $('.tutorial-active').removeClass('tutorial-active');
        pageState.tutorial.tutorialStep++;
    } else if (pageState.tutorial.tutorialPath[pageState.tutorial.tutorialPart+1] != undefined) {
        $('.tutorial-active').removeClass('tutorial-active');
        pageState.tutorial.tutorialPart++;
        pageState.tutorial.tutorialStep = 0;
    } else {
        FMA.endTutorial();
        return;
    }

    FMA.checkTutorialNavigation();
    FMA.loadTutorialStep();
});

$(document).on('click', '#tutorial-skip-part-button', async function () {
    if (pageState.tutorial.tutorialPath[pageState.tutorial.tutorialPart+1] != undefined) {
        $('.tutorial-active').removeClass('tutorial-active');
        pageState.tutorial.tutorialPart++;
        pageState.tutorial.tutorialStep = 0;
    } else {
        /*FMA.endTutorial();*/
        return;
    }

    FMA.checkTutorialNavigation();
    FMA.loadTutorialStep();
});
$(document).on('click', '#tutorial-start-button', async function () {
    FMA.startTutorial();
    $('#tutorial-notification').remove();
});

$(document).on('click', '.tutorial-end-button', async function () {
    FMA.endTutorial();
});

$(document).on('click', '#add-filter', async function () {
    var feed = $('#filter-new').attr('data-feed');
    var field = $('#filter-new .filter-field-input').val();
    var operator = $('#filter-new .filter-operator [selected=selected]').attr('value');
    var value = $('#filter-new .filter-value-input').val();
    await FMA.addFilter(feed, field, operator, value);
    FMA.pushNotification('' + feed + ' filter added');
    $('#filter-changes-warning').show();
    await FMA.reloadFeedFilters();
    //await FMA.storage.sync.setItem("rssFeeds", pageState.rssFeeds);
    await FMA.clearCache();
});

$(document).on('click', '#clear-storage', async function () {
    await FMA.clearStorage();
});

$('#filter-value-input').keypress(async function (e) {
    if (e.which == 13) {
        var feed = $('#filter-new').attr('data-feed');
        var field = $('#filter-new .filter-field-input').val();
        var operator = $('#filter-new .filter-operator [selected=selected]').attr('value');
        var value = $('#filter-new .filter-value-input').val();
        await FMA.addFilter(feed, field, operator, value);
        FMA.pushNotification('' + feed + ' filter added');
        $('#filter-changes-warning').show();
        await FMA.reloadFeedFilters();
        await FMA.storage.sync.setItem("rssFeeds", pageState.rssFeeds);
        await FMA.clearCache();
        return false;
    }
});

$('#main-refresh-icon').on({
    mouseenter: function () {
        $(this).find('#refresh-icon').addClass('fa-spin');
    },
    mouseleave: function () {
        $(this).find('#refresh-icon').removeClass('fa-spin');
    }
});

$(document).on('click', '#main-refresh-icon', async function () {
    pageState.animeListings = [];
    await FMA.sync();
});

$(function () {
    FeedMeAnime.initialize();
});