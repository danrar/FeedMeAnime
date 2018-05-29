var themes = {
  Console: "Console",
  BlackWhite: "BlackWhite",
  Smooth: "Smooth"
};
var animeListings = [];
var anime = [];
//anime [nickname, actual]
var rss = [];
//var suggestions = new Array()
var suggestions = [];
//var filters = [];
var filters = {};
var thumbnails = [];
//var htmlCache = "";
var lastCacheTime = new Date();
var loadTime = $.now();
var settings = {
  theme: themes.BlackWhite
};





//var anime = ["Overlord II", "Mahoutsukai no Yome"];
//var rss = [["Horrible Subs","http://horriblesubs.info/rss.php?res=1080"], ["Nyaa.si","https://nyaa.si/?page=rss"]];

document.addEventListener('DOMContentLoaded', function() {
  chrome.storage.sync.get(["cacheSettings"], function(cache) {
    if (cache.cacheSettings.theme != "undefined"){
      settings.theme = cache.cacheSettings.theme;
      $.each(themes, function(index, value){
        var select = '';
        if(settings.theme === value){
          $('#themes-select').append($('<option/>').attr('value', index).text(value).attr('selected','selected'));
        } else{
          $('#themes-select').append($('<option/>').attr('value', index).text(value));
        }
      });
    }

    //Default filters
    var key = "Nyaa.si";
    var value = "nyaa:categoryId,1_2";

    addFilter(key, value);

    $('head').append( $('<link rel="stylesheet" type="text/css" />').attr('href', 'themes/' + settings.theme + '.css') );
    $("body").addClass(`theme-${settings.theme.dasherize().toLowerCase()}`);

    chrome.storage.local.get(["thumbnailCache"], function (results) {
      thumbnails = results.thumbnailCache;
      chrome.storage.sync.get(["animeList"], function (animeList) {
        if (animeList.animeList) {
          anime = animeList.animeList;
        }
        chrome.storage.sync.get(["rssFeeds"], function (rssList) {
          if (rssList.rssFeeds) {
            rss = rssList.rssFeeds;
          }
          chrome.storage.sync.get(["filters"], function (filterData) {
            if (filterData.filters){
              filters = filterData.filters;
            }
            chrome.storage.sync.get(["cacheTimeString"], function (obj) {
             if (obj.cacheTimeString) {
               var cacheTimeString = new Date(obj.cacheTimeString.date);
               var maxCache = new Date(cacheTimeString.getTime() + 1800000);
             }

             if (maxCache && maxCache > loadTime) {
               chrome.storage.local.get(["animeListings"], function (data) {
                 animeListings = data.animeListings;
                 sync();
               });
             } else {
               animeListings = [];
               sync();
               //$('#title').append('not cached');
             }
            });
          });
        }); 
      });
    });
  });


  $('#add-anime').click(function() {
    $('#overlay').show();
    $('#overlay').animate({
         opacity: 1
       }, 500, function() {
          reloadAnime();
          loadSuggestions();
          $('.content').hide();
          $('#anime-info').show();
          $('#anime-suggestions').show();
          $('#controls').show();
          $('#anime-input').show();
          $('#overlay').animate({ opacity: 0 }, 500, function(){
            $('#overlay').hide();
          });
       });
  });
  
  $('#add-feed').click(function() {
    $('#overlay').show();
    $('#overlay').animate({
         opacity: 1
       }, 500, function() {
          reloadFeeds();
          $('.content').hide();
          $('#feed-info').show();
          $('#controls').show();
          $('#feed-input').show();
          $('#overlay').animate({ opacity: 0 }, 500, function(){
            $('#overlay').hide();
          });
       });
  });

  $('#change-settings').click(function() {
    $('#overlay').show();
    $('#overlay').animate({
         opacity: 1
       }, 500, function() {
          reloadFilters();
          reloadStorageStats();
          $('.content').hide();
          $('#settings').show();
          $('#overlay').animate({ opacity: 0 }, 500, function(){
            $('#overlay').hide();
          });
       });
  });
  
  $('#sync').click(function() {
    $('#overlay').show();
    $('#overlay').animate({
         opacity: 1
       }, 500, function() {
          sync();
          $('.content').hide();
          $('#main').show();
          $('#overlay').animate({ opacity: 0 }, 500, function(){
            $('#overlay').hide();
          });
       });
  });
  
  //$(document).on('click', '.remove-anime', function () {
  //  var index = anime.indexOf($(this).parent().data('title'));
  //  if (index > -1) {
  //    anime.splice(index, 1);
  //  }
  //  chrome.storage.sync.set({ animeList: anime });
  //  reloadAnime();
  //  clearCache();
  //})

  $(document).on('click', '.remove-anime', function () {
    animeTitle = getArrayInArray(anime, $(this).parent().data('nickname'))
    var index = anime.indexOf(animeTitle);
    if (index > -1) {
      anime.splice(index, 1);
    }
    chrome.storage.sync.set({ animeList: anime });
    reloadAnime();
    clearCache();
  })
  
  $(document).on('click', '.remove-feed', function () {
    rssFeed = getArrayInArray(rss, $(this).parent().data('feed-title'))
    var index = rss.indexOf(rssFeed);
    if (index > -1) {
      rss.splice(index, 1);
    }
    chrome.storage.sync.set({ rssFeeds: rss });
    reloadFeeds();
    clearCache();
  })

  $(document).on('click', '.remove-filter', function () {
    removeFilter($(this).parent().find('.filter-feed').data('feed'));
    chrome.storage.sync.set({ cacheFilters: filters });
    reloadFilters();
    clearCache();
  })

  $(document).on('click', '#save-settings', function () {
    
    $.each(themes, function(index, value){
      if (value === $( "#themes-select option:selected" ).attr('value')){
        settings.theme = value;
        return false;
      } 
    });

    chrome.storage.sync.set({ filters: filters });

    chrome.storage.sync.set({ cacheSettings: settings });

    location.reload();
  })

  $(document).on('click', '.clipboard-title-copy', function () {
    var copyText = $(this).closest('.result').find('.info-label')[0]
    copyText.select();
    document.execCommand("Copy");
  });

  $(document).on('click', '.clipboard-magnet-copy', function () {
    var copyText = $(this).closest('.result').find('.info-link')[0]
    copyText.select();
    document.execCommand("Copy");
  });

  $(document).on('click', '#clear-cache', function () {
    clearCache();
  });

  //$('#anime-input').keypress(function (e) {
  //  if (e.which == 13) {
  //    anime.push($('#anime-input').val());
  //    reloadAnime();
  //    chrome.storage.sync.set({ animeList: anime });
  //    clearCache();
  //    return false;
  //  }
  //});
  
  $('#anime-input').keypress(function (e) {
    if (e.which == 13) {
      var array = $('#anime-input').val().split(' - ');
      anime.push(array);
      reloadAnime();
      chrome.storage.sync.set({ animeList: anime });
      clearCache();
      return false;
    }
  });

  $('#feed-input').keypress(function (e) {
    if (e.which == 13) {
      var array = $('#feed-input').val().split(' - ');
      rss.push(array);
      reloadFeeds();
      chrome.storage.sync.set({ rssFeeds: rss });
      clearCache();
      return false;
    }
  });

  $(document).on('click', '.anime-suggestion', function () {
    var title = $(this).data('title');
    var nickname = prompt("Give this anime a nickname? (Leave blank for actual)", "");
    if (!nickname) {
      nickname = title;
    }
    var selection = [nickname, title];
    anime.push(selection);
    reloadAnime();
    chrome.storage.sync.set({ animeList: anime });
    clearCache();
    getDataUri($(this).data('imageurl'), function(dataUri) {
      if (thumbnails){
        thumbnails.push({title: title,data: dataUri});
      } else {
        thumbnails = [{title: title,data: dataUri}];
      }

      chrome.storage.local.set({thumbnailCache: thumbnails})
    });
  });

 $(document).on('click', '.change-label', function () {
    var nickname = $(this).parent().data('nickname');
    var title = $(this).parent().data('title');
    var label = $(this).parent().data('label');

    var newLabel = prompt("Give this anime a label?", label);

    var index = anime.indexOf(nickname);
    anime[index] = [nickname, title, newLabel];

    reloadAnime();
    chrome.storage.sync.set({ animeList: anime });
    clearCache();
    getDataUri($(this).data('imageurl'), function(dataUri) {
      if (thumbnails){
        thumbnails.push({title: nickname,data: dataUri});
      } else {
        thumbnails = [{title: title,data: dataUri}];
      }

      chrome.storage.local.set({thumbnailCache: thumbnails})
    });
  });
  

  $(document).on('click', '#add-filter', function () {
    var feed = $('#filter-feed-input').val();
    var value = $('#filter-value-input').val();
    addFilter(feed, value);
    reloadFilters();
    chrome.storage.sync.set({ rssFeeds: rss });
    clearCache();
  });

  $(document).on('click', '#clear-storage', function () {
    clearStorage();
  });

  $('#filter-value-input').keypress(function (e) {
    if (e.which == 13) {
      var feed = $('#filter-feed-input').val();
      var value = $('#filter-value-input').val();
      addFilter(feed, value);
      reloadFilters();
      chrome.storage.sync.set({ rssFeeds: rss });
      clearCache();
      return false;
    }
  });
}, false);

function clearCache(){
  animeListings = [];
  chrome.storage.local.set({ animeListings: animeListings }, function(){
    chrome.storage.local.get(["animeListings"], function(data) {
      animeListings = data.animeListings;
    });
  });
}

//function clearStorage(){
//  chrome.storage.local.clear();
//  chrome.storage.sync.clear();
//}

function parseRSS(rssUrl){
  var json = "";
    $.ajax({
        url: rssUrl,
        type: 'GET',
        cache: false,
        async: false,
        dataType: "xml"
  }).done(function(data) {
    json = $.xml2json(data);
  }).fail(function(e) {
    alert( e.message );
  });
  return json;
}

function getPopular(offset){
  var json = "";
    $.ajax({
        url: 'https://kitsu.io/api/edge/anime?filter[status]=current&filter[subtype]=TV&page[limit]=20&page[offset]='+ offset +'&sort=popularityRank&fields[anime]=canonicalTitle,posterImage',
        type: 'GET',
        cache: false,
        async: false,
        dataType: "json"
  }).done(function(data) {
    json = data;
  }).fail(function(e) {
    alert( e.message );
  });
  return json;
}

function sync(){
  $('#main').html("");
  if(animeListings.length == 0 && rss.length > 0) {
    for(feed of rss) {
      var rssJson = parseRSS(feed[1]);
      var objects = rssJson;
      if(filters.hasOwnProperty(feed[0])) {
        var objects = filterObjects(rssJson, getFilter(feed[0]));
      } 
      for(title of anime) {
        var nicknameResults = getObjects(objects, 'title', title[0]);
        var titleResults = getObjects(objects, 'title', title[1]);
        $(nicknameResults).each(function(i, object){
          if(animeListings){
            animeListings.push(object)
          } else {
            animeListings = [object];
          }
        });

        //$(titleResults).each(function(i, object){
        //  if(animeListings){
        //    
        //    animeListings.push(object)
        //  } else {
        //    animeListings = [object];
        //  }
        //});
      }
    }

    var cacheTime = new Date().getTime();
    var cacheTimeString = { "date" : cacheTime };
    chrome.storage.sync.set({cacheTimeString:cacheTimeString});
  }

  chrome.storage.local.set({ animeListings: animeListings });

  for(title of anime) {
    var results = getObjects(animeListings, 'title', title[0]);
    $(results).each(function(i, object){
      var imgString = '';
      if(thumbnails){
        var thumb = getObjects(thumbnails, 'title', title[0]);
        if(thumb.length > 0){
          imgString = '<img class="anime-thumbnail" src="'+ thumb[0].data +'" />';
        }
      }
      $('#main').append('<div class="anime-block">'+ imgString +'<div data-title="'+ object['title'] +'" data-link="'+ object['link'] +'" class="result"> <div class="info-title">'+ object['title'] +'</div> <div class="anime-outputs"> <input type="text" class="info-label" value="'+ title[0] +' (A)"><div class="icon clipboard-title-copy"><i class="fa fa-copy"></i></div></div> <input type="text" class="info-link" value="'+ object['link'] +'"><div class="icon clipboard-magnet-copy"><i class="fa fa-copy"></i></div></div></div>');
    });
  }
  
}

function reloadAnime(){
  $('#anime-info').html('<div id="anime-info-title">Anime</div>');
  if(anime.length > 0){
    for(title of anime){
      var animeTitle;
      var animeNickname;
      var animeLabelRaw = '';
      var displaytext;

      if(title.length < 4){
        var text = title[0];
        if(title[0] != title[1])
        {
          displaytext = title[0] + " - " + title[1]
        } else {
          displaytext = title[1];
        }
        animeNickname = title[0];
        animeTitle = title[1];
      } else {
        animeTitle = title;
        animeNickname = title;
        displayText = title;
      }

      if (title.Length > 2)
      {
        var animeLabel = title[2];
        animeLabelRaw = ' data-label="' + animeLabel + '"';
        displaytext = displaytext + ' - ' + animeLabel;
      }

      $('#anime-info').append('<div data-nickname="'+ animeNickname +'" data-title="'+ animeTitle +'"'+ animeLabelRaw +' class="anime-title"> '+ displaytext +' <div class="icon change-label"><i class="fa fa-pencil-alt"></i></div><div class="icon remove-anime"><i class="fa fa-times"></i></div></div>');
    }
  }
}

function reloadFeeds(){
  $('#feed-info').html('<div id="feed-info-title">Feeds</div>');
  if(rss.length > 0){
    for(array of rss){
      $('#feed-info').append('<div data-feed-title="'+ array[0] +'" data-feed-url="'+ array[1] +'" class="anime-title"> '+ array[0] +' - '+ array[1] +' <div class="icon remove-feed"><i class="fa fa-times"></i></div></div>');
    }
  }
}

function reloadFilters(){
  $('#filter-configuration').html('<input type="text" class="rq-form-element" id="filter-feed-input" /> <input type="text" class="rq-form-element" id="filter-value-input" /><div class="icon" id="add-filter"><i class="fa fa-arrow-alt-circle-right"></i></div>');
  if(Object.keys(filters).length > 0){
    for(var key in filters){
      $('#filter-configuration').prepend('<div class="filter"><div data-feed="'+ key +'" class="filter-feed"> '+ key +' </div> <div data-value="'+ filters[key] +'" class="filter-value"> '+ filters[key] +' </div> <div class="icon remove-filter"><i class="fa fa-times"></i></div></div>');
    }
  }
}

function reloadStorageStats(){
  var sync = chrome.storage.sync.getBytesInUse(null, function(data){
    $('#storage-sync-text').html('' + data + ' / ' + chrome.storage.sync.QUOTA_BYTES +'');
  });
  var local = chrome.storage.local.getBytesInUse(null, function(data){
    $('#storage-local-text').html('' + data +' / ' + chrome.storage.local.QUOTA_BYTES + '');
  });
}

function loadSuggestions(){
  var suggestionsCount = 40;
  $('#anime-suggestions-options').html('');
  suggestions = [];
  for (i = 0; i < suggestionsCount; i = i + 20){
    var results = getPopular(i);
    $(results.data).each(function(j, object){
      if(suggestions){
        suggestions.push(object);
      } else {
        suggestions = [object];
      }
    });
  };

  $(suggestions).each(function(j, object){
    $('#anime-suggestions-options').append('<div data-title="'+ object.attributes['canonicalTitle'] +'" data-imageurl="'+ object.attributes.posterImage['tiny'] +'" class="anime-suggestion"> '+ object.attributes['canonicalTitle'] +' </div>');
  });
  
}

//function saveThumbnails(){
//    getDataUri($(this).data('imageurl'), function(dataUri) {
//      if (thumbnails){
//        thumbnails.push({title: title,data: dataUri});
//      } else {
//        thumbnails = [{title: title,data: dataUri}];
//      }
//
//      chrome.storage.local.set({thumbnails: thumbnails})
//    });
//}

function isItemInArray(array, item) {
    for (var i = 0; i < array.length; i++) {
        if (array[i][0] == item) {
          return true;
        }
    }
    return false;
}

function getArrayInArray(array, item) {
    for (var i = 0; i < array.length; i++) {
        if (array[i][0] == item || array[i] == item) {
          return array[i];
        }
    }
    return null;
}

function addFilter(key, value) {
    filters[key] = value;
}

function removeFilter(key) {
    delete filters[key];
}

function getFilter(key) {
    return filters[key];
}

function filterObjects(obj, filterString){
  var objects = [];
  if(filterString){
    var filters = filterString.split(';');
    for (var filter in filters)
    {
      var parts = filters[filter].split(',');
      objects = getObjects(obj, parts[0], parts[1]);
    }
  }
  else{
    objects = obj;
  }

  return objects;
}

function getObjects(obj, key, val) {
    var objects = [];
    for (var i in obj) {
        if (!obj.hasOwnProperty(i)) continue;
        if (typeof obj[i] == 'object') {
            objects = objects.concat(getObjects(obj[i], key, val));    
        } else 
        if (i == key && ~obj[i].indexOf(val) || i == key && obj[i] == val || i == key && val == '') { //
            objects.push(obj);
        } else if (~obj[i].indexOf(val) && key == ''){
            if (objects.lastIndexOf(obj) == -1){
                objects.push(obj);
            }
        }
    }
    return objects;
}

function getDataUri(url, callback) {
  var image = new Image();
  image.src = url;
  image.onload = function () {
      var canvas = document.createElement('canvas');
      canvas.width = this.naturalWidth;
      canvas.height = this.naturalHeight;
      canvas.getContext('2d').drawImage(this, 0, 0);
      // ... or get as Data URI
      callback(canvas.toDataURL('image/png'));
  };
}

String.prototype.dasherize = function () {
  console.log(this);
  return this.replace(/[A-Z]/g, function (char, index) {
    return (index !== 0 ? '-' : '') + char.toLowerCase();
  });
};
