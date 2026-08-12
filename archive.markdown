---
layout: page
title: Archive
permalink: /archive/
---

<ul class="archive-list">
  {% for post in site.posts %}
    <li>
      <p class="archive-date">{{ post.date | date: "%b %-d, %Y" }}</p>
      <h3><a href="{{ post.url | relative_url }}">{{ post.title }}</a></h3>
      {% if post.description %}
        <p>{{ post.description }}</p>
      {% else %}
        <p>{{ post.excerpt | strip_html | truncate: 140 }}</p>
      {% endif %}
    </li>
  {% endfor %}
</ul>
