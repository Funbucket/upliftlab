"""The language of the messages the engine sends to the screen: errors, data checks and notices.

Korean by default. The web screen calls bridge.set_lang('en') when its interface is in English, so a message reads
tr('한국어', 'English') where it is raised. The catalog and the algorithm docstrings stay Korean; the screen has its own
English text for those.
"""
LANGS = ('ko', 'en')
lang = 'ko'


def set_lang(value):
    global lang
    if value in LANGS:
        lang = value
    return lang


def tr(ko, en):
    return en if lang == 'en' else ko
