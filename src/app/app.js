import * as _ from "lodash";
import * as slugify from "slugify";
import * as forage from "localforage";
import * as CryptoJS from "crypto-js";
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
        title: "Horrible Subs",
        url: "http://horriblesubs.info/rss.php?res=1080",
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
    filters: {},
    thumbnails: [],
    lastCacheTime: new Date(),
    loadTime: $.now(),
    settings: {
        theme: "Smooth",
        labelAsTag: false,
        parseLinks: false,
        consolidateResults: false 
    }
    //To Add
    //setting remove duplicates
    //setting infohash to magnet link
}

if (!String.prototype.format) {
    String.prototype.format = function () {
        var args = arguments;
        return this.replace(/{(\d+)}/g, function (match, number) {
            return typeof args[number] != 'undefined'
                ? args[number]
                : match
                ;
        });
    };
}

FeedMeAnime.setSettings = function () {
    logger.debug("Updating app settings!");
    $.each(pageState.themes, (index, value) => {
        const opts = $("<option/>").attr("value", index).text(value);
        if (pageState.settings.theme === value) {
            $("#themes-select").append(opts.attr("selected", "selected"));
        } else {
            $("#themes-select").append(opts)
        }
    });

    $("#label-tag-checkbox").prop("checked", pageState.settings.labelAsTag);
    $("#parse-links-checkbox").prop("checked", pageState.settings.parseLinks);
    $("#consolidate-results-checkbox").prop("checked", pageState.settings.consolidateResults);
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
                        var nicknameResults = this.getObjects(pageState.rssContents[contenti].contents, feed.titleField, pageState.anime[j].nickname);
                        var titleResults = this.getObjects(pageState.rssContents[contenti].contents, feed.titleField, pageState.anime[j].title);
    
                        for (var k = 0; k < nicknameResults.length; k++) {
                            pageState.animeListings.push({ title: nicknameResults[k][feed.titleField], link: nicknameResults[k][feed.linkField] })
                        }
    
                        for (var l = 0; l < titleResults.length; l++) {
                            if (this.getObjects(pageState.animeListings, 'title', pageState.anime[j].title).length < 1) {
                                pageState.animeListings.push({ title: titleResults[l][feed.titleField], link: titleResults[l][feed.linkField] })
                            }
                        }
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
        let results = this.getObjects(pageState.animeListings, "title", title.nickname);
        if (results.length === 0) {
            results = this.getObjects(pageState.animeListings, "title", title.title);
        }

        let animeIdent = title.nickname;

        if (pageState.settings.labelAsTag && title.label) {
            animeIdent = title.label;
        }

        let defaultTag = "{0} (A)";

        let tagText = defaultTag.format(animeIdent);
        let imgString = "";

        if (pageState.thumbnails) {
            let thumb = this.getObjects(pageState.thumbnails, "title", title.nickname);
            if (thumb.length == 0) {
                thumb = this.getObjects(pageState.thumbnails, "title", title.title);
            }

            if (thumb.length > 0) {
                imgString = `<img class="anime-thumbnail" src="${thumb[0].data}"/>`;
            }
        }

        if(pageState.settings.consolidateResults) {
            FeedMeAnime.consolidateResults(results, title, imgString, tagText);
        } else {
            var array = await FeedMeAnime.listResults(results, title, imgString, tagText);
            toReorder.push.apply(toReorder, array);
        }
    }

    _.forEach(toReorder, (val) => {
        FeedMeAnime.setAnimeSeen($('#' + val));
    });
}

FeedMeAnime.filterObjects = function (obj, filterString) {
    var objects = [];
    if (filterString) {
        var filters = filterString.split(';');
        for (var filter in filters) {
            var parts = filters[filter].split(',');
            objects = this.getObjects(obj, parts[0], parts[1]);
        }
    }
    else {
        objects = obj;
    }

    return objects;
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
            url: `https://kitsu.io/api/edge/anime?filter[status]=current&filter[subtype]=TV&page[limit]=20&page[offset]=${offset}&sort=popularityRank&fields[anime]=canonicalTitle,posterImage`,
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
            url: `https://kitsu.io/api/edge/anime?filter[text]=${searchText}&page[limit]=1&fields[anime]=canonicalTitle,posterImage`,
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

            $("#anime-entries").append(`
                <div data-index="${i}" data-nickname="${animeNickname}" data-title="${animeTitle}" ${animeLabelRaw} data-thumbnailurl="${anime.thumbnailUrl}" class="anime-title">
                    <div class="icon remove-anime" title="Delete">
                        <i class="fa fa-times"></i>
                    </div>
                    <div class="icon change-label" title="Change Label">
                        <i class="fa fa-tag"></i>
                    </div>
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
                    <div class="feed-expand"><i class="fas fa-fw fa-caret-right"></i><i class="fas fa-fw fa-caret-down"></i></div>
                    <div class="feed-title-text">${feed.title} -</div>
                    <div class="feed-url-text"><a href="${feed.url}" title="${feed.url}" target="_blank">${feed.url}</a></div>
                    <div class="icon deactivate-feed${boltClass}">
                        <i class="fa fa-bolt"></i>
                    </div>
                    <div class="icon remove-feed">
                        <i class="fa fa-times"></i>
                    </div>
                </div>
                <div data-feed-title="${feed.title}" class="feed-contents">
                </div>
            `);

        }
    }
}

FeedMeAnime.reloadFilters = function () {
    $("#filter-configuration").html(`
        <input type="text" class="rq-form-element" id="filter-feed-input"/>
        <input type="text" class="rq-form-element" id="fitler-value-input"/>
        <div class="icon" id="add-filter">
            <i class="fa fa-arrow-alt-circle-right"></i>
        </div
    `);

    if (Object.keys(pageState.filters).length > 0) {
        for (let key in pageState.filters) {
            const filterVal = _.get(pageState.filters, key);
            $("#filter-configration").prepend(`
                <div class="filter">
                    <div data-feed="${key}" class="filter-feed">
                        ${key}
                    </div>
                    <div data-value="${filterVal}" class="fitler-value">
                        ${filterVal}
                    </div>
                    <div class="icon remove-filter">
                        <i class="fa fa-times"></i>
                    </div>
                </div>
            `);
        }
    }
}

FeedMeAnime.reloadStorageStats = function () {
    chrome.storage.sync.getBytesInUse(null, function (data) {
        $("#storage-sync-text").html(`${data} / ${chrome.storage.sync.QUOTA_BYTES}`);
    });

    chrome.storage.local.getBytesInUse(null, function (data) {
        $("#storage-local-text").html(`${data} / ${chrome.storage.local.QUOTA_BYTES}`);
    });
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
                <div data-title="${val.attributes["canonicalTitle"]}" data-imageurl="${_.get(val, "attributes.posterImage.tiny")}" class="anime-suggestion">
                    ${val.attributes["canonicalTitle"]}
                </div>
            `);
        }
        i++;
    });

    $("#anime-title-input").autocomplete({
        source: pageState.suggestions.items.map(suggestion => suggestion.attributes["canonicalTitle"]),
        minLength: 2
    });
}

FeedMeAnime.updateFeedContents = async function (feedTitle = null) {
    for (var i = 0; i < pageState.rssFeeds.length; i++) {
        if (feedTitle == null || pageState.rssFeeds[i].title == feedTitle) {
            const feed = await this.getRss(pageState.rssFeeds[i]);
            if (feed != null) {
                var objects = _.get(feed, "rss.channel.item");
    
                if (_.has(pageState.filters, pageState.rssFeeds[i].title)) {
                    objects = this.getObjects(_.get(feed, "rss.channel.item"), _.get(pageState.filters, pageState.rssFeeds[i].title));
                }
    
                if (pageState.rssContents) {
                    if (this.getObjects(pageState.rssContents, 'title', pageState.rssFeeds[i].title).length < 1) {
                        pageState.rssContents.push({ title: pageState.rssFeeds[i].title, contents: objects });
                    }
                } else {
                    pageState.rssContents = [{ title: pageState.rssFeeds[i].title, contents: objects }];
                }
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

FeedMeAnime.listResults = async function(results, title, imgString, tagText) {
    var hashes = [];
    _.forEach(results, (val) => {
        let payoffCode = `<div class="output"><input type="text" class="info-link" value="${val["link"]}"><div class="icon clipboard-magnet-copy" title="Highlight"><i class="fa fa-copy"></i></div></div>`;
        var titleHash = CryptoJS.HmacSHA1(val["title"], "password").toString();

        if (pageState.settings.parseLinks) {
            if (!val["link"].includes('magnet:') && (val["link"].includes('www.') || val["link"].includes('http://') || val["link"].includes('https://'))) {
                payoffCode = `<div class="output"><div class="output-link"><a href="${val["link"]}" target="_blank" title="${val["link"]}">${val["title"]}</a></div></div>`;
            }
        }
        
        $("#main").append(`<div class="anime-block" id="${titleHash}">
                                    ${imgString}
                                    <div data-title="${val["title"]}" class="result">
                                        <div class="info-title">${val["title"]}</div>
                                        <div class="anime-outputs">
                                            <input type="text" class="info-label" value="${tagText}"><div class="icon clipboard-title-copy" title="Highlight"><i class="fa fa-copy"></i></div>
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

FeedMeAnime.consolidateResults = async function(results, title, imgString, tagText) { 
    let individualResults = [];

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
            payoff: payoffCode
        })
    });

    if(individualResults.length > 0){
        let allPayoffs = "";
        _.forEach(individualResults, (val) => {
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

window.FMA = FeedMeAnime;

/**
 * Page Events
 */

$(document).on("click", ".notification-close", function () {
    $(this).parent().remove();
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
        await FMA.reloadFilters();
        await FMA.reloadStorageStats();
        $('.active-tab').removeClass('active-tab');
        $('#change-settings').addClass('active-tab');
        $('.content').hide();
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
    $('.feed-expand').each(function () {

        let targetFeed = $(this).parent();
        let feedTitle = targetFeed.data('feed-title');
        let feedContentContainer = $(`.feed-contents[data-feed-title='${feedTitle}']`)[0];
        $(this).attr('data-toggled', 'false');
        $(this).find('.fa-caret-down').hide();
        $(this).find('.fa-caret-right').show();
        $(feedContentContainer).slideUp();
    })

    let targetFeed = $(this).parent();
    let feedTitle = targetFeed.data('feed-title');
    let feedTitleField = targetFeed.data('feed-title-field');
    let feedLinkField = targetFeed.data('feed-link-field');
    let feedContentContainer = $(`.feed-contents[data-feed-title='${feedTitle}']`)[0];

    if (!$(this).attr('data-toggled') || $(this).attr('data-toggled') == 'false') {

        if (FMA.getObjects(pageState.rssContents, 'title', feedTitle).length == 0) {
            await FMA.updateFeedContents(feedTitle);
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
        $(feedContentContainer).delay(200).slideDown();
        $(this).attr('data-toggled', 'true');
    } else {
        $(feedContentContainer).slideUp();
        $(this).attr('data-toggled', 'false');
    }

    $(this).children('.fa-fw').toggle();
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

$(document).on('click', '.remove-feed', async function () {
    var index = $(this).parent().data('index');
    if (index > -1) {
        pageState.rssFeeds.splice(index, 1);
    }
    await FMA.storage.sync.setItem("rssFeeds", pageState.rssFeeds);
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

$(document).on('click', '.remove-filter', async function () {
    delete pageState.filters[$(this).parent().find('.filter-feed').data('feed')];
    await FMA.storage.sync.setItem("cacheFilters", pageState.filters);
    await FMA.reloadFilters();
    await FMA.clearCache();
})

$(document).on('click', '#save-settings', async function () {
    $.each(pageState.themes, function (index, value) {
        if (value === $("#themes-select option:selected").attr('value')) {
            pageState.settings.theme = value;
            return false;
        }
    });
    pageState.settings.labelAsTag = $('#label-tag-checkbox').prop('checked');
    pageState.settings.parseLinks = $('#parse-links-checkbox').prop('checked');
    pageState.settings.consolidateResults = $('#consolidate-results-checkbox').prop('checked');
    await FMA.storage.sync.setItem("filters", pageState.filters);
    await FMA.storage.sync.setItem("cacheSettings", pageState.settings);
    location.reload();
})

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

$(document).on('click', '#clear-cache', async function () {
    await FMA.clearCache();
});

$(document).on('click', '#anime-add-icons', async function () {
    debugger;
    var title = $('#anime-title-input').val();
    var nickname = $('#anime-nickname-input').val();
    var label = $('#anime-label-input').val();
    var thumbnailUrl = $('#anime-thumburl-input').val();
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
            await FMA.addThumbnail(animeDetails.data[0].attributes["canonicalTitle"], animeDetails.data[0].attributes.posterImage['tiny']);
            thumbnailUrl = animeDetails.data[0].attributes.posterImage['tiny'];
        }
    } else {
        await FMA.addThumbnail(title, thumbnailUrl);
    }

    var selection = { nickname: nickname, title: title, label: label, thumbnailUrl: thumbnailUrl };

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

$(document).on('click', '.anime-suggestion', async function () {
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


$(document).on('click', '#add-filter', async function () {
    var feed = $('#filter-feed-input').val();
    var value = $('#filter-value-input').val();
    await FMA.addFilter(feed, value);
    await FMA.reloadFilters();
    await FMA.storage.sync.setItem("rssFeeds", pageState.rssFeeds);
    await FMA.clearCache();
});

$(document).on('click', '#clear-storage', async function () {
    await FMA.clearStorage();
});

$('#filter-value-input').keypress(async function (e) {
    if (e.which == 13) {
        var feed = $('#filter-feed-input').val();
        var value = $('#filter-value-input').val();
        await FMA.addFilter(feed, value);
        await FMA.reloadFilters();
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


