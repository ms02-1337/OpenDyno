"""
Package setup configuration.
"""
from setuptools import setup, find_packages

with open("README.md", "r", encoding="utf-8") as fh:
    long_description = fh.read()

setup(
    name="opendyno",
    version="0.1.0",
    author="Your Name",
    author_email="your.email@example.com",
    description="A motor dynamometer testing system with CAN bus communication",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/yourusername/OpenDyno",
    packages=find_packages(exclude=["tests", "tests.*"]),
    classifiers=[
        "Development Status :: 3 - Alpha",
        "Intended Audience :: Developers",
        "Topic :: Scientific/Engineering",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
    ],
    python_requires=">=3.8",
    install_requires=[
        "Flask>=3.0.0",
        "flask-socketio>=5.3.0",
        "gevent>=23.9.1",
        "gevent-websocket>=0.10.1",
        "python-can>=4.3.0",
        "python-dotenv>=1.0.0",
    ],
    extras_require={
        "dev": [
            "pytest>=7.4.0",
            "pytest-cov>=4.1.0",
            "pytest-flask>=1.3.0",
            "black>=23.0.0",
            "flake8>=6.0.0",
            "mypy>=1.7.0",
        ],
    },
    entry_points={
        "console_scripts": [
            "opendyno=run:main",
        ],
    },
)
