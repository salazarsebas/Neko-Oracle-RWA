import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PriceStreamProcessorService } from './price-stream-processor.service';
import { NormalizationService } from './normalization.service';
import { AggregationService } from './aggregation.service';
import { DebugService } from '../debug/debug.service';
import { PriceInputDto } from '../dto/price-input.dto';
import {
  NormalizedPriceRecord,
  NormalizedSource,
} from '../interfaces/normalized-price.interface';

describe('PriceStreamProcessorService', () => {
  let service: PriceStreamProcessorService;
  let normalizationService: jest.Mocked<NormalizationService>;
  let aggregationService: jest.Mocked<AggregationService>;
  let debugService: jest.Mocked<DebugService>;
  let configService: jest.Mocked<ConfigService>;

  const NOW = 1700000000000;

  const makeDto = (overrides: Partial<PriceInputDto> = {}): PriceInputDto => {
    const dto = new PriceInputDto();
    dto.symbol = 'AAPL';
    dto.price = 150.0;
    dto.source = 'alpha_vantage';
    dto.timestamp = '2024-01-15T14:30:00.000Z';
    Object.assign(dto, overrides);
    return dto;
  };

  const makeNormalizedRecord = (
    overrides: Partial<NormalizedPriceRecord> = {},
  ): NormalizedPriceRecord => ({
    symbol: 'AAPL',
    price: 150.0,
    timestamp: '2024-01-15T14:30:00.000Z',
    originalTimestamp: NOW - 1000,
    source: NormalizedSource.ALPHA_VANTAGE,
    metadata: {
      originalSource: 'alpha_vantage',
      originalSymbol: 'AAPL',
      normalizedAt: new Date().toISOString(),
      normalizerVersion: '1.0.0',
      wasTransformed: false,
      transformations: [],
    },
    ...overrides,
  });

  beforeEach(async () => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PriceStreamProcessorService,
        {
          provide: NormalizationService,
          useValue: { normalize: jest.fn() },
        },
        {
          provide: AggregationService,
          useValue: { aggregate: jest.fn() },
        },
        {
          provide: DebugService,
          useValue: {
            setLastNormalized: jest.fn(),
            setLastAggregated: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: unknown) => {
              const config: Record<string, unknown> = {
                AGG_TIME_WINDOW_MS: 30000,
                AGG_MIN_SOURCES: 3,
              };
              return config[key] ?? defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get(PriceStreamProcessorService);
    normalizationService = module.get(NormalizationService);
    aggregationService = module.get(AggregationService);
    debugService = module.get(DebugService);
    configService = module.get(ConfigService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('DTO → RawPrice conversion', () => {
    it('should convert ISO timestamp string to Unix ms', () => {
      const record = makeNormalizedRecord();
      normalizationService.normalize.mockReturnValue(record);

      const dto = makeDto({ timestamp: '2024-01-15T14:30:00.000Z' });
      service.handlePriceReceived(dto);

      expect(normalizationService.normalize).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol: 'AAPL',
          price: 150.0,
          source: 'alpha_vantage',
          timestamp: new Date('2024-01-15T14:30:00.000Z').getTime(),
        }),
      );
    });
  });

  describe('NormalizedPriceRecord → NormalizedPrice conversion', () => {
    it('should map originalTimestamp to timestamp and source enum to string', () => {
      const record = makeNormalizedRecord({
        originalTimestamp: NOW - 2000,
        source: NormalizedSource.YAHOO_FINANCE,
      });
      normalizationService.normalize.mockReturnValue(record);

      const dto = makeDto({ source: 'yahoo_finance' });
      service.handlePriceReceived(dto);

      expect(debugService.setLastNormalized).toHaveBeenCalledWith(
        'AAPL',
        expect.arrayContaining([
          expect.objectContaining({
            timestamp: NOW - 2000,
            source: 'yahoo_finance',
          }),
        ]),
      );
    });
  });

  describe('happy path', () => {
    it('should normalize, buffer, and update debug store', () => {
      const record = makeNormalizedRecord();
      normalizationService.normalize.mockReturnValue(record);

      service.handlePriceReceived(makeDto());

      expect(normalizationService.normalize).toHaveBeenCalledTimes(1);
      expect(debugService.setLastNormalized).toHaveBeenCalledWith(
        'AAPL',
        expect.arrayContaining([
          expect.objectContaining({
            symbol: 'AAPL',
            price: 150.0,
          }),
        ]),
      );
    });
  });

  describe('normalization failure', () => {
    it('should catch error and not rethrow', () => {
      normalizationService.normalize.mockImplementation(() => {
        throw new Error('No normalizer found');
      });

      expect(() => service.handlePriceReceived(makeDto())).not.toThrow();
      expect(debugService.setLastNormalized).not.toHaveBeenCalled();
    });
  });

  describe('buffer dedup', () => {
    it('should replace existing entry from the same source', () => {
      const record1 = makeNormalizedRecord({
        price: 150.0,
        originalTimestamp: NOW - 2000,
      });
      const record2 = makeNormalizedRecord({
        price: 151.0,
        originalTimestamp: NOW - 1000,
      });

      normalizationService.normalize
        .mockReturnValueOnce(record1)
        .mockReturnValueOnce(record2);

      service.handlePriceReceived(makeDto({ price: 150.0 }));
      service.handlePriceReceived(makeDto({ price: 151.0 }));

      // The second call should replace the first — buffer has 1 entry
      const lastCall =
        debugService.setLastNormalized.mock.calls[
          debugService.setLastNormalized.mock.calls.length - 1
        ];
      const buffer = lastCall[1];

      expect(buffer).toHaveLength(1);
      expect(buffer[0].price).toBe(151.0);
    });
  });

  describe('buffer pruning', () => {
    it('should remove entries outside the time window', () => {
      // First price: old timestamp (outside 30s window)
      const oldRecord = makeNormalizedRecord({
        originalTimestamp: NOW - 60000,
        source: NormalizedSource.ALPHA_VANTAGE,
      });
      // Second price: recent timestamp from different source
      const recentRecord = makeNormalizedRecord({
        originalTimestamp: NOW - 1000,
        source: NormalizedSource.FINNHUB,
      });

      normalizationService.normalize
        .mockReturnValueOnce(oldRecord)
        .mockReturnValueOnce(recentRecord);

      service.handlePriceReceived(makeDto({ source: 'alpha_vantage' }));
      service.handlePriceReceived(makeDto({ source: 'finnhub' }));

      const lastCall =
        debugService.setLastNormalized.mock.calls[
          debugService.setLastNormalized.mock.calls.length - 1
        ];
      const buffer = lastCall[1];

      // Old entry should be pruned; only the recent one remains
      expect(buffer).toHaveLength(1);
      expect(buffer[0].source).toBe('finnhub');
    });
  });

  describe('aggregation NOT triggered', () => {
    it('should not call aggregate when fewer than minSources distinct sources', () => {
      const record = makeNormalizedRecord();
      normalizationService.normalize.mockReturnValue(record);

      // Only 1 source — minSources is 3
      service.handlePriceReceived(makeDto());

      expect(aggregationService.aggregate).not.toHaveBeenCalled();
    });
  });

  describe('aggregation triggered', () => {
    it('should call aggregate when minSources threshold is met', () => {
      const sources = [
        NormalizedSource.ALPHA_VANTAGE,
        NormalizedSource.FINNHUB,
        NormalizedSource.YAHOO_FINANCE,
      ];

      sources.forEach((source, i) => {
        normalizationService.normalize.mockReturnValueOnce(
          makeNormalizedRecord({
            originalTimestamp: NOW - (i + 1) * 1000,
            source,
          }),
        );
        service.handlePriceReceived(makeDto({ source: source as string }));
      });

      expect(aggregationService.aggregate).toHaveBeenCalledTimes(1);
      expect(aggregationService.aggregate).toHaveBeenCalledWith(
        'AAPL',
        expect.arrayContaining([
          expect.objectContaining({ source: 'alpha_vantage' }),
          expect.objectContaining({ source: 'finnhub' }),
          expect.objectContaining({ source: 'yahoo_finance' }),
        ]),
        { minSources: 3, timeWindowMs: 30000 },
      );
    });
  });

  describe('aggregation failure', () => {
    it('should catch aggregate errors and not rethrow', () => {
      const sources = [
        NormalizedSource.ALPHA_VANTAGE,
        NormalizedSource.FINNHUB,
        NormalizedSource.YAHOO_FINANCE,
      ];

      aggregationService.aggregate.mockImplementation(() => {
        throw new Error('Insufficient recent sources');
      });

      sources.forEach((source, i) => {
        normalizationService.normalize.mockReturnValueOnce(
          makeNormalizedRecord({
            originalTimestamp: NOW - (i + 1) * 1000,
            source,
          }),
        );
      });

      // Should not throw
      expect(() => {
        sources.forEach((source) => {
          service.handlePriceReceived(makeDto({ source: source as string }));
        });
      }).not.toThrow();
    });
  });

  describe('configuration', () => {
    it('should read AGG_TIME_WINDOW_MS and AGG_MIN_SOURCES from ConfigService with defaults', () => {
      expect(configService.get).toHaveBeenCalledWith(
        'AGG_TIME_WINDOW_MS',
        30000,
      );
      expect(configService.get).toHaveBeenCalledWith('AGG_MIN_SOURCES', 3);
    });
  });
});
