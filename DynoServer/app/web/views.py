from flask import render_template, Blueprint

# Flask blueprint for web routes
web_app = Blueprint("web", __name__)

# Index page
@web_app.route('/')
def index():
    return render_template('index.html')

# Config page
@web_app.route('/config')
def config():
    return render_template('configuration.html')

# Debug page
@web_app.route('/debug')
def debug():
    return render_template('debug.html')

# Logs page
@web_app.route('/logs')
def logs():
    return render_template('logs.html')