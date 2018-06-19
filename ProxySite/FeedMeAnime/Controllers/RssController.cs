using System;
using Microsoft.AspNetCore.Mvc;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using System.Xml;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;

namespace FeedMeAnime.Controllers
{
    [Route("rss")]
    public class RssController : Controller
    {
        private readonly IHttpClientFactory _clientFactory;
        private readonly IMemoryCache _cache;
        private readonly IConfiguration _configuration;

        public RssController(IHttpClientFactory clientFactory, IMemoryCache cache, IConfiguration configuration)
        {
            _clientFactory = clientFactory ?? throw new ArgumentNullException(nameof(clientFactory));
            _cache = cache ?? throw new ArgumentNullException(nameof(cache));
            _configuration = configuration ?? throw new ArgumentNullException(nameof(configuration));
        }

        [HttpGet]
        public async Task<IActionResult> Proxy(string rssUrl, bool skipCache = false)
        {
            try
            {
                var cacheKey = GenerateHash(rssUrl);
                var entry = _cache.Get<XmlDocument>(cacheKey);

                if (entry == null || skipCache)
                {
                    var client = _clientFactory.CreateClient("rssFeed");
                    client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/xml"));
                    var res = await client.GetAsync(rssUrl);

                    if (!res.IsSuccessStatusCode)
                    {
                        return BadRequest(res.ReasonPhrase);
                    }

                    entry = new XmlDocument();
                    entry.Load(await res.Content.ReadAsStreamAsync());

                    var cacheEntryOptions = new MemoryCacheEntryOptions().SetAbsoluteExpiration(TimeSpan.FromMinutes(_configuration.GetSection("Cache").GetValue<int>("TTL")));
                    _cache.Set(cacheKey, entry, cacheEntryOptions);
                }

                return Json(entry);
            }
            catch (Exception ex)
            {
                return StatusCode(500, ex.Message);
            }
        }

        private static string GenerateHash(string input)
        {
            using (var md5 = MD5.Create())
            {
                var inputBytes = Encoding.ASCII.GetBytes(input);
                var hashBytes = md5.ComputeHash(inputBytes);

                var sb = new StringBuilder();
                foreach (var t in hashBytes)
                {
                    sb.Append(t.ToString("X2"));
                }
                return sb.ToString();
            }
        }
    }
}