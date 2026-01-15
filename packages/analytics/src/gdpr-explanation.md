# Question

Why can't I load the gtm script until consent has been granted? Isn't the point of the gtag('consent') call to disable the parts of GA that would track with cookies?

# Answer

In theory you **can** load Google Tag Manager (or the Google tag) immediately and rely on

```js
gtag('consent','default',{…all denied…})
```

to block cookies. That is Google’s **“Advanced Consent Mode”** implementation. But many privacy teams still choose the stricter **“Basic”** approach—holding the whole GTM payload until the visitor has opted-in—because the *practical* and *legal* differences between the two modes are bigger than the single line of code suggests.

---

### 1 What still happens when GTM loads in “default-denied” mode?

|                          | Advanced Consent Mode                                                                                                       | Basic Consent Mode                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Tag loading              | Runs as soon as the page loads (cookies start **denied**)                                                                   | Blocked until the user interacts with the banner |
| Data sent before consent | **Cookieless pings** that include the consent state plus network-level data (IP address, UA string, referrer, screen size…) | **Nothing at all**—not even the consent state    |
| Regulatory posture       | You must justify why sending those pings (and the cross-border transfer) is lawful without prior consent                    | No processing ⇒ no lawful-basis debate up-front  |

Google’s own help page spells this out: the advanced mode “loads with defaults set to *denied* … **While consent is denied, the Google tags send cookieless pings**.” ([Google Help][1])

Those pings are small and Google deletes the IP immediately, but they **do travel to Google’s servers and necessarily contain the visitor’s IP address** (still personal data under GDPR Recital 30) together with user-agent & screen info. ([Google Help][2])

---

### 2 Why some DPOs insist on deferring the script

1. **Zero-data guarantee** – If the tags never load, you can state truthfully that *no personal data leaves the browser until consent*, eliminating legitimate-interest debates.

2. **Cross-border transfer risk** – Several EU DPAs (Austria, France, Italy, Finland …) have already ruled that sending even *anonymised* GA data to the US violates GDPR because the IP address is still transmitted. ([noyb.eu][3]) Blocking the whole script sidesteps this argument.

3. **Mis-fire protection** – GTM can host any third-party or custom HTML tag. If one of those tags ignores Consent Mode (or you forget to flag it), it can drop cookies before you notice. Loading GTM only after an explicit “Accept” keeps that surface area at zero.

4. **Simpler audits** – Regulators (and your own QA) only have to confirm that the banner works. They don’t need to inspect every tag template or network request for possible leaks.

5. **Easier banner copy** – Most consent banners promise “no tracking before consent.” Basic mode makes that statement literally true; advanced mode makes it… *mostly* true and therefore potentially misleading.

---

### 3 When is Advanced mode worth the trade-off?

* **You really need Google’s modelling uplift.**
  Cookieless pings feed GA4 and Ads’ conversion-modelling, so you lose some reporting accuracy in Basic mode.

* **You’re satisfied your international-transfer safeguards are rock-solid** (e.g., Google Analytics 4 with EU Data Boundary + new adequacy decision, plus your own SCCs and DPIA).

* **Your legal basis is clear.** Some controllers rely on *legitimate interest* for those minimal pings and reserve *consent* exclusively for cookies and personalised ads. That position must be documented.

If you go the “Advanced” route, make sure you also:

1. **Enable `ads_data_redaction`** so ad-click IDs are stripped while consent is denied.
2. **Double-check every custom tag’s consent settings in GTM.**
3. **Document the residual personal data (IP, UA, etc.)** in your Record of Processing Activities and privacy notice.

---

### 4 Bottom line

*`gtag('consent','default',{…denied…})`* only prevents **cookies**; it does **not** prevent **all data** leaving the browser.
If you want the cleanest, least-arguable GDPR story—*“no personal data is processed until the user opts-in”*—keep GTM blocked until the banner returns **“granted.”**

If you need Google’s modelling and are comfortable defending the minimal data transfer, load GTM up-front with **Advanced Consent Mode**—but be very explicit about that in your privacy documentation and banner wording.

[1]: https://support.google.com/tagmanager/answer/14009635?hl=en "Set up consent mode - Tag Manager Help"
[2]: https://support.google.com/analytics/answer/13802165?hl=en "Consent mode reference - Analytics Help"
[3]: https://noyb.eu/en/update-further-eu-dpa-orders-stop-google-analytics "UPDATE: Further EU DPA orders stop of Google Analytics"