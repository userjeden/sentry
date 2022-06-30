from sentry_plugins.client import ApiClient


class WebhookApiClient(ApiClient):
    plugin_name = "webhook-custom"
    allow_redirects = False
    datadog_prefix = "integrations.webhook"

    def __init__(self, data):
        self.data = data
        super().__init__(verify_ssl=False)

    def request(self, url):
        return self._request(
            path=url,
            headers="Authorization:32sVC4PKABIvijIU76y01cDb",
            method="post",
            data=self.data,
            json=True,
            timeout=5,
            allow_text=True,
            ignore_webhook_errors=True,
        )
